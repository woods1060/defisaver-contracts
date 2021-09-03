const nullAddress = '0x0000000000000000000000000000000000000000';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

const { deployContract } = require("../deployers/utils/deployer");

const impersonateAccount = async (account) => {
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [account]}
    );
};

const stopImpersonatingAccount = async (account) => {
    await hre.network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [account]}
    );
};

const formatExchangeObj = (srcAddr, destAddr, amount, wrapper, destAmount = 0, uniV3fee) => {
    const abiCoder = new hre.ethers.utils.AbiCoder();

    let firstPath = srcAddr;
    let secondPath = destAddr;

    if (srcAddr.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
        firstPath = WETH_ADDRESS;
    }

    if (destAddr.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
        secondPath = WETH_ADDRESS;
    }

    // quick fix if we use strategy placeholder value
    if (firstPath[0] === '%' || firstPath[0] === '&') {
        firstPath = nullAddress;
        secondPath = nullAddress;
    }

    let path = abiCoder.encode(['address[]'], [[firstPath, secondPath]]);
    if (uniV3fee > 0) {
        if (destAmount > 0) {
            path = hre.ethers.utils.solidityPack(['address', 'uint24', 'address'], [secondPath, uniV3fee, firstPath]);
        } else {
            path = hre.ethers.utils.solidityPack(['address', 'uint24', 'address'], [firstPath, uniV3fee, secondPath]);
        }
    }
    return [
        srcAddr,
        destAddr,
        amount,
        destAmount,
        0,
        0,
        nullAddress,
        wrapper,
        path,
        [nullAddress, nullAddress, nullAddress, 0, 0, hre.ethers.utils.toUtf8Bytes('')],
    ];
};


const getProxyWithSigner = async (signer, addr) => {
    const proxyRegistry = await
    hre.ethers.getContractAt("contracts/interfaces/ProxyRegistryInterface.sol:ProxyRegistryInterface", "0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4");

    let proxyAddr = await proxyRegistry.proxies(addr);

    if (proxyAddr == nullAddress) {
        await proxyRegistry.build(addr);
        proxyAddr = await proxyRegistry.proxies(addr);
    }

    const dsProxy = await hre.ethers.getContractAt("contracts/DS/DSProxy.sol:DSProxy", proxyAddr, signer);

    return dsProxy;
}

const setNewExchangeWrapper = async (acc, newAddr) => {
    const exchangeOwnerAddr = '0xBc841B0dE0b93205e912CFBBd1D0c160A1ec6F00';
    await impersonateAccount(exchangeOwnerAddr);

    const signer = await hre.ethers.provider.getSigner(exchangeOwnerAddr);

    const registryInstance = await hre.ethers.getContractFactory('SaverExchangeRegistry');
    const registry = await registryInstance.attach('0x25dd3F51e0C3c3Ff164DDC02A8E4D65Bb9cBB12D');
    const registryByOwner = registry.connect(signer);

    await registryByOwner.addWrapper(newAddr, { gasLimit: 300000 });
    await stopImpersonatingAccount(exchangeOwnerAddr);
};

const approve = async (tokenAddr, to) => {
    const tokenContract = await hre.ethers.getContractAt('ERC20', tokenAddr);

    const allowance = await tokenContract.allowance(tokenContract.signer.address, to);

    if (allowance.toString() === '0') {
        await tokenContract.approve(to, hre.ethers.constants.MaxUint256, { gasLimit: 1000000 });
    }
};

const depositToWeth = async (amount) => {
    const weth = await hre.ethers.getContractAt('TokenInterface', WETH_ADDRESS);

    await weth.deposit({ value: amount });
};

const balanceOf = async (tokenAddr, addr) => {
    const tokenContract = await hre.ethers.getContractAt('ERC20', tokenAddr);
    let balance = '';

    if (tokenAddr.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
        balance = await hre.ethers.provider.getBalance(addr);
    } else {
        balance = await tokenContract.balanceOf(addr);
    }
    return balance;
};

const send = async (tokenAddr, to, amount) => {
    const tokenContract = await hre.ethers.getContractAt('ERC20', tokenAddr);

    await tokenContract.transfer(to, amount);
};

const timeTravel = async (timeIncrease) => {
    await hre.network.provider.request({
        method: 'evm_increaseTime',
        params: [timeIncrease],
        id: new Date().getTime(),
    });
};

const getRatio = async (mcdSaverMonitor, cdpId) => {
    const ratio = await mcdSaverMonitor.getRatio(cdpId, 0);

    return ratio / 1e16;
};

module.exports = {
    impersonateAccount,
    stopImpersonatingAccount,
    formatExchangeObj,
    getProxyWithSigner,
    setNewExchangeWrapper,
    approve,
    depositToWeth,
    balanceOf,
    send,
    timeTravel,
    getRatio,
    WETH_ADDRESS,
};
