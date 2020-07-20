pragma solidity ^0.6.0;

import "../../utils/FlashLoanReceiverBase.sol";
import "../../interfaces/DSProxyInterface.sol";
import "../../utils/SafeERC20.sol";
import "../../exchange/SaverExchangeCore.sol";
import "../../shifter/ShifterRegistry.sol";

/// @title Contract that receives the FL from Aave for Creating loans
contract CompoundCreateReceiver is FlashLoanReceiverBase, SaverExchangeCore {

    ILendingPoolAddressesProvider public LENDING_POOL_ADDRESS_PROVIDER = ILendingPoolAddressesProvider(0x24a42fD28C976A61Df5D00D0599C34c4f90748c8);
    ShifterRegistry public constant shifterRegistry = ShifterRegistry(0xD280c91397C1f8826a82a9432D65e4215EF22e55);

    address public constant ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    constructor() FlashLoanReceiverBase(LENDING_POOL_ADDRESS_PROVIDER) public {}

    /// @notice Called by Aave when sending back the FL amount
    /// @param _reserve The address of the borrowed token
    /// @param _amount Amount of FL tokens received
    /// @param _fee FL Aave fee
    /// @param _params The params that are sent from the original FL caller contract
   function executeOperation(
        address _reserve,
        uint256 _amount,
        uint256 _fee,
        bytes calldata _params)
    external override {
        // Format the call data for DSProxy
        (address payable proxyAddr, bytes memory proxyData, ExchangeData memory exchangeData)
                                 = packFunctionCall(_amount, _fee, _params);

        // Swap
        exchangeData.srcAmount -= _fee;
        _sell(exchangeData);

        // Send amount to DSProxy
        sendToProxy(proxyAddr, exchangeData.destAddr);

        address compOpenProxy = shifterRegistry.getAddr("COMP_SHIFTER");

        // Execute the DSProxy call
        DSProxyInterface(proxyAddr).execute(0x4d040B247949a76cB8134203Da822Da50C674557, proxyData);

        // Repay the loan with the money DSProxy sent back
        transferFundsBackToPoolInternal(_reserve, _amount.add(_fee));

        // if there is some eth left (0x fee), return it to user
        if (address(this).balance > 0) {
            tx.origin.transfer(address(this).balance);
        }
    }

    /// @notice Formats function data call so we can call it through DSProxy
    /// @param _amount Amount of FL
    /// @param _fee Fee of the FL
    /// @param _params Saver proxy params
    function packFunctionCall(uint _amount, uint _fee, bytes memory _params) internal pure  returns (address payable, bytes memory proxyData, ExchangeData memory exchangeData) {
        (
            uint[4] memory numData, // srcAmount, destAmount, minPrice, price0x
            address[6] memory addrData, // cCollAddr, cDebtAddr, srcAddr, destAddr, exchangeAddr, wrapper
            bytes memory callData,
            address proxy
        )
        = abi.decode(_params, (uint256[4],address[6],bytes,address));

        proxyData = abi.encodeWithSignature(
            "open(address,address,uint256)",
                                addrData[0], addrData[1], (_amount + _fee));

         exchangeData = SaverExchangeCore.ExchangeData({
            srcAddr: addrData[2],
            destAddr: addrData[3],
            srcAmount: numData[0],
            destAmount: numData[1],
            minPrice: numData[2],
            wrapper: addrData[5],
            exchangeAddr: addrData[4],
            callData: callData,
            price0x: numData[3]
        });

        return (payable(proxy), proxyData, exchangeData);
    }

    /// @notice Send the FL funds received to DSProxy
    /// @param _proxy DSProxy address
    /// @param _reserve Token address
    function sendToProxy(address payable _proxy, address _reserve) internal {
        if (_reserve != ETH_ADDRESS) {
            ERC20(_reserve).safeTransfer(_proxy, ERC20(_reserve).balanceOf(address(this)));
        }

        _proxy.transfer(address(this).balance);
    }

    receive() external override(FlashLoanReceiverBase, SaverExchangeCore) payable {}
}