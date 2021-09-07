const { changeConstantInFile } = require("../../deployers/utils/utils.js");

const dfs = require("@defisaver/sdk");

const { deployContract } = require("../../deployers/utils/deployer");
const {
    impersonateAccount,
    getProxyWithSigner,
    formatExchangeObj,
    depositToWeth,
    send,
    timeTravel,
    getRatio,
    WETH_ADDRESS
} = require("../new-utils.js");

const BOT_ACCC = "0x5aa40C7C8158D8E29CA480d7E05E5a32dD819332";

const ETH_JOIN = "0x2F0b23f53734252Bda2277357e97e1517d6B042A";
const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ADMIN_ACC = "0x0528a32fda5bedf89ba9ad67296db83c9452f28c";
const USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const aWethAddr = "0x030ba81f1c18d280636f32af80b9aad02cf0854e";

const nullAddress = '0x0000000000000000000000000000000000000000';

const uniV2WrapperAddr = "0x6403BD92589F825FfeF6b62177FCe9149947cb9f";
const monitorProxyAddr = "0x380982902872836ceC629171DaeAF42EcC02226e";

const aaveMarket = '0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5';

const supplyAave = async (proxy, amount) => {

    await depositToWeth(amount.toString());
    console.log('depositToWeth');
    await send(WETH_ADDRESS, proxy.address, amount);

    console.log('send');
 
    const aaveSupplyAddr = '0xC71113E9122465e8bCd42123f840Df99abaF29F1';

    const aaveSupplyAction = new dfs.actions.aave.AaveSupplyAction(
        aaveMarket,
        WETH_ADDRESS,
        amount,
        proxy.address,
        nullAddress,
    );
    const functionData = aaveSupplyAction.encodeForDsProxyCall()[1];

    console.log('Proxy call');

    await proxy['execute(address,bytes)'](aaveSupplyAddr, functionData, { gasLimit: 3000000 });
};

const withdrawAave = async (proxy, market, amount, to) => {
    const aaveWithdrawAddr = '0xE06Fc1CBD78Eb0799d5B0ca62D51B065886e08FC';

    const aaveWithdrawAction = new dfs.actions.aave.AaveWithdrawAction(
        market,
        WETH_ADDRESS,
        amount,
        to,
    );
    const functionData = aaveWithdrawAction.encodeForDsProxyCall()[1];

    console.log('aaveWithdrawAction before');

    await proxy['execute(address,bytes)'](aaveWithdrawAddr, functionData, { gasLimit: 3000000 });

    console.log('aaveWithdrawAction after');

};

describe("Aave-Monitor", function() {
    this.timeout(600000);

    let senderAcc,
        proxy,
        aaveSaverReceiverOv2,
        aaveSaverFlashLoan,
        aaveSaverTakerOV2,
        aaveMonitor,
        aaveLoanInfoV2V2;

    before(async () => {
        senderAcc = (await hre.ethers.getSigners())[0];
        aaveSaverReceiverOv2 = await deployContract("AaveSaverReceiverOV2");

        aaveLoanInfoV2 = await deployContract("AaveLoanInfoV2");

        await changeConstantInFile(
            "./contracts",
            ["AaveSaverTakerOV2"],
            "AAVE_RECEIVER",
            aaveSaverReceiverOv2.address
        );

        await hre.run('compile');

        aaveSaverTakerOV2 = await deployContract("AaveSaverTakerOV2");

        aaveMonitorV2 = await deployContract("AaveMonitorV2", aaveSaverTakerOV2.address);

        await impersonateAccount(ADMIN_ACC);
        const adminSigner = await hre.ethers.provider.getSigner(ADMIN_ACC);

        const aaveProxyInstance = await hre.ethers.getContractFactory(
            "AaveMonitorProxyV2",
            adminSigner
        );
        const monitorProxy = await aaveProxyInstance.attach(monitorProxyAddr);

        await monitorProxy.changeMonitor(aaveMonitorV2.address);

        await timeTravel(49 * 60 * 60); // move 49h

        await monitorProxy.confirmNewMonitor();
    });

    // test at block 13146320
    const aavePositionAddr = "0x6278acd3143f5e16aa3420457fc641d635442d1f";
    const supplyAmount = hre.ethers.utils.parseUnits("55", "18");
    const withdrawAmount = hre.ethers.utils.parseUnits("105", "18");

    const boostAmount = hre.ethers.utils.parseUnits("20000", "6");
    const repayAmount = hre.ethers.utils.parseUnits("10", "18");

    it(`... should preform an automatic boost for aave position: ${aavePositionAddr}`, async () => {
        const ownerSigner = await hre.ethers.provider.getSigner(aavePositionAddr);
        await impersonateAccount(aavePositionAddr);

        proxy = await getProxyWithSigner(ownerSigner, aavePositionAddr);
        proxy.connect(aavePositionAddr);

        await supplyAave(proxy, supplyAmount);

        await impersonateAccount(BOT_ACCC);
        const botSigner = await hre.ethers.provider.getSigner(BOT_ACCC);

        aaveMonitorV2 = aaveMonitorV2.connect(botSigner);

        const exchangeData = formatExchangeObj(
            USDC_ADDRESS,
            ETH_ADDRESS,
            boostAmount,
            uniV2WrapperAddr,
            0
        );

        const ratioBefore = await aaveLoanInfoV2.getRatio(aaveMarket, proxy.address);
        console.log(`Ratio before boost ${ratioBefore / 1e16}`);

        // send tx
        await aaveMonitorV2.boostFor(exchangeData, proxy.address, 2, 0, {
            gasLimit: 8000000
        });

        const ratioAfter = await aaveLoanInfoV2.getRatio(aaveMarket, proxy.address);
        console.log(`Ratio after boost ${ratioAfter /  1e16}`);
    });

    it(`... should preform an automatic repay for aave position: ${aavePositionAddr}`, async () => {

        const ownerSigner = await hre.ethers.provider.getSigner(aavePositionAddr);
        await impersonateAccount(aavePositionAddr);

        proxy = await getProxyWithSigner(ownerSigner, aavePositionAddr);
        proxy.connect(aavePositionAddr);

        await withdrawAave(proxy, aaveMarket, withdrawAmount, senderAcc.address);

        await impersonateAccount(BOT_ACCC);
        const botSigner = await hre.ethers.provider.getSigner(BOT_ACCC);

        aaveMonitorV2 = aaveMonitorV2.connect(botSigner);

        const exchangeData = formatExchangeObj(
            ETH_ADDRESS,
            USDC_ADDRESS,
            repayAmount,
            uniV2WrapperAddr,
            0
        );

        const ratioBefore = await aaveLoanInfoV2.getRatio(aaveMarket, proxy.address);
        console.log(`Ratio before repay ${ratioBefore / 1e16}`);

        // send tx
        await aaveMonitorV2.repayFor(exchangeData, proxy.address, 2, 0, { gasLimit: 8000000 });

        const ratioAfter = await aaveLoanInfoV2.getRatio(aaveMarket, proxy.address);
        console.log(`Ratio after repay ${ratioAfter /  1e16}`);
    });
});
