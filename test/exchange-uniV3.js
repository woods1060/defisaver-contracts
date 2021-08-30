const { expect } = require("chai");
const hre = require("hardhat");

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


describe("Exchange-UniV3", function() {
    this.timeout(600000);

    let senderAcc, proxy, uniV3WrapperV3, allowanceProxy, mcdSaverTaker;

    const allowanceAddr = '0x05B393D06d7a97c20e216B5e8b9375F8C741C58f';

    before(async () => {

        senderAcc = (await hre.ethers.getSigners())[0];

        uniV3WrapperV3 = await deployContract("UniV3WrapperV3");
        mcdSaverTaker = await deployContract("MCDSaverTaker");

        allowanceProxy = await hre.ethers.getContractAt('contracts/exchangeV3/AllowanceProxyV3.sol:AllowanceProxy', allowanceAddr);

        senderAcc = await (await hre.ethers.getSigners())[0];
        proxy = await getProxyWithSigner(senderAcc, senderAcc.address);

        proxy.connect(senderAcc);

        console.log('Proxy: ', proxy.address);

        await setNewExchangeWrapper(senderAcc, uniV3WrapperV3.address);
    });

    it('... should call eth -> dai sell with uniV3 wrapper', async () => {

        const ethAmount = hre.ethers.utils.parseUnits('1', '18');

        const fee = 3000;

        const exchangeData = formatExchangeObj(
            ETH_ADDRESS,
            DAI_ADDRESS,
            ethAmount,
            uniV3WrapperV3.address,
            0,
            fee
        );

        const balanceBefore = await balanceOf(DAI_ADDRESS, senderAcc.address)

        await allowanceProxy.callSell(exchangeData, { value: ethAmount, gasLimit: 8000000 });

        const balanceAfter = await balanceOf(DAI_ADDRESS, senderAcc.address)

        console.log(balanceBefore / 1e18, ' -> ', balanceAfter / 1e18);

        expect(balanceAfter / 1e18).to.be.gt(balanceBefore / 1e18);
        
    }).timeout(100000);

    it('... should call weth -> dai sell with uniV3 wrapper', async () => {

        const ethAmount = hre.ethers.utils.parseUnits('1', '18');

        const fee = 3000;

        const exchangeData = formatExchangeObj(
            WETH_ADDRESS,
            DAI_ADDRESS,
            ethAmount,
            uniV3WrapperV3.address,
            0,
            fee
        );

        await depositToWeth(ethAmount);
        await approve(WETH_ADDRESS, allowanceAddr);

        const balanceBefore = await balanceOf(DAI_ADDRESS, senderAcc.address)

        await allowanceProxy.callSell(exchangeData, { gasLimit: 8000000 });

        const balanceAfter = await balanceOf(DAI_ADDRESS, senderAcc.address)

        console.log(balanceBefore / 1e18, ' -> ', balanceAfter / 1e18);

        expect(balanceAfter/ 1e18).to.be.gt(balanceBefore / 1e18);

        
    }).timeout(100000);

    it('... should call eth -> dai buy with uniV3 wrapper', async () => {

        const ethAmount = hre.ethers.utils.parseUnits('1', '18');
        const daiAmount = hre.ethers.utils.parseUnits('2000', '18');

        const fee = 3000;

        const exchangeData = formatExchangeObj(
            ETH_ADDRESS,
            DAI_ADDRESS,
            ethAmount,
            uniV3WrapperV3.address,
            daiAmount,
            fee
        );

        const balanceBefore = await balanceOf(DAI_ADDRESS, senderAcc.address)

        await allowanceProxy.callBuy(exchangeData, { value: ethAmount, gasLimit: 8000000 });

        const balanceAfter = await balanceOf(DAI_ADDRESS, senderAcc.address)

        console.log(balanceBefore / 1e18, ' -> ', balanceAfter / 1e18);

        expect(balanceAfter / 1e18).to.be.gt((balanceBefore / 1e18));
        
    }).timeout(100000);

    it('... should call weth -> dai buy with uniV3 wrapper', async () => {
        const ethAmount = hre.ethers.utils.parseUnits('1', '18');
        const daiAmount = hre.ethers.utils.parseUnits('2000', '18');


        const fee = 3000;

        const exchangeData = formatExchangeObj(
            WETH_ADDRESS,
            DAI_ADDRESS,
            ethAmount,
            uniV3WrapperV3.address,
            daiAmount,
            fee
        );

        await depositToWeth(ethAmount);
        await approve(WETH_ADDRESS, allowanceAddr);

        const balanceBefore = await balanceOf(DAI_ADDRESS, senderAcc.address)

        await allowanceProxy.callBuy(exchangeData, { gasLimit: 8000000 });

        const balanceAfter = await balanceOf(DAI_ADDRESS, senderAcc.address)

        console.log(balanceBefore / 1e18, ' -> ', balanceAfter / 1e18);

        expect(balanceAfter/ 1e18).to.be.gt(balanceBefore / 1e18);

        
    }).timeout(100000);

});
