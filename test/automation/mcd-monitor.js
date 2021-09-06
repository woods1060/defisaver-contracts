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

const managerAddr = "0x5ef30b9986345249bc32d8928B7ee64DE9435E39";
const BOT_ACCC = "0x5aa40C7C8158D8E29CA480d7E05E5a32dD819332";

const ETH_JOIN = "0x2F0b23f53734252Bda2277357e97e1517d6B042A";
const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ADMIN_ACC = "0xBc841B0dE0b93205e912CFBBd1D0c160A1ec6F00";

const uniV2WrapperAddr = "0x6403BD92589F825FfeF6b62177FCe9149947cb9f";
const monitorProxyAddr = "0x1816A86C4DA59395522a42b871bf11A4E96A1C7a";

const supplyMcd = async (signer, proxy, vaultId, amount, joinAddr, from) => {
    const mcdSupplyAddr = "0xD3C50623F44E97B59CFbfC1232146858be18e6cc";

    await depositToWeth(amount);
    await send(WETH_ADDRESS, proxy.address, amount);

    console.log("deposited");

    const mcdSupplyAction = new dfs.actions.maker.MakerSupplyAction(
        vaultId,
        amount,
        joinAddr,
        from,
        managerAddr
    );
    const functionData = mcdSupplyAction.encodeForDsProxyCall()[1];

    await proxy["execute(address,bytes)"](mcdSupplyAddr, functionData, { gasLimit: 3000000 });
};

const withdrawMcd = async (proxy, vaultId, amount, joinAddr, to) => {
    const mcdWithdrawAddr = "0x19654613812850081D80e7EC992e8F71DcbD30B4";

    const mcdWithdrawAction = new dfs.actions.maker.MakerWithdrawAction(
        vaultId,
        amount,
        joinAddr,
        to,
        managerAddr
    );
    const functionData = mcdWithdrawAction.encodeForDsProxyCall()[1];

    await proxy["execute(address,bytes)"](mcdWithdrawAddr, functionData, { gasLimit: 3000000 });
};


describe("Mcd-Monitor", function() {
    this.timeout(600000);

    let senderAcc, proxy, mcdSaverFlashLoan, mcdSaverTaker, mcdMonitorV2;

    before(async () => {
        senderAcc = (await hre.ethers.getSigners())[0];
        mcdSaverFlashLoan = await deployContract("MCDSaverFlashLoan");

        await changeConstantInFile(
            "./contracts",
            ["MCDSaverTaker"],
            "MCD_SAVER_FLASH_LOAN",
            mcdSaverFlashLoan.address
        );

        await hre.run('compile');

        mcdSaverTaker = await deployContract("MCDSaverTaker");

        mcdMonitorV2 = await deployContract("MCDMonitorV2", mcdSaverTaker.address);

        await impersonateAccount(ADMIN_ACC);
        const adminSigner = await hre.ethers.provider.getSigner(ADMIN_ACC);

        const monitorProxyInstance = await hre.ethers.getContractFactory('MCDMonitorProxyV2', adminSigner);
        const monitorProxy = await monitorProxyInstance.attach(monitorProxyAddr);

        await monitorProxy.changeMonitor(mcdMonitorV2.address);

        await timeTravel(49*60*60); // move 49h

        await monitorProxy.confirmNewMonitor();

    });

    // test at block 13146320
    const cdpId = "10474";
    const supplyAmount = hre.ethers.utils.parseUnits("1", "18");
    const withdrawAmount = hre.ethers.utils.parseUnits("15", "18");

    const boostAmount = hre.ethers.utils.parseUnits("5000", "18");
    const repayAmount = hre.ethers.utils.parseUnits("2", "18");

    it(`... should preform an automatic boost for cdp: ${cdpId}`, async () => {

        // get owner of cdpId
        const ownerAddr = await mcdSaverTaker.getOwner(managerAddr, cdpId);
        const ownerSigner = await hre.ethers.provider.getSigner(ownerAddr);
        await impersonateAccount(ownerAddr);

        proxy = await getProxyWithSigner(ownerSigner, ownerAddr);
        proxy.connect(ownerAddr);

        // withdraw eth to trigger
        await supplyMcd(ownerSigner, proxy, cdpId, supplyAmount, ETH_JOIN, proxy.address);

        console.log("After supply");

        // simulate bot
        await impersonateAccount(BOT_ACCC);
        const botSigner = await hre.ethers.provider.getSigner(BOT_ACCC);

        mcdMonitorV2 = mcdMonitorV2.connect(botSigner);

        const exchangeData = formatExchangeObj(
            DAI_ADDRESS,
            ETH_ADDRESS,
            boostAmount,
            uniV2WrapperAddr,
            0
        );

        const ratioBefore = await getRatio(mcdMonitorV2, cdpId);
        console.log(`Ratio of #${cdpId} before Boost is: ${ratioBefore}`);

        // send tx
        await mcdMonitorV2.boostFor(exchangeData, cdpId, 0, ETH_JOIN, { gasLimit: 8000000 });

        const ratioAfter = await getRatio(mcdMonitorV2, cdpId);
        console.log(`Ratio of #${cdpId} after Boost is: ${ratioAfter}`);
    });

    it(`... should preform an automatic repay for cdp: ${cdpId}`, async () => {

        // get owner of cdpId
        const ownerAddr = await mcdSaverTaker.getOwner(managerAddr, cdpId);
        const ownerSigner = await hre.ethers.provider.getSigner(ownerAddr);
        await impersonateAccount(ownerAddr);

        proxy = await getProxyWithSigner(ownerSigner, ownerAddr);
        proxy.connect(ownerAddr);

        await withdrawMcd(proxy, cdpId, withdrawAmount, ETH_JOIN, senderAcc.address);

        // simulate bot
        await impersonateAccount(BOT_ACCC);
        const botSigner = await hre.ethers.provider.getSigner(BOT_ACCC);

        mcdMonitorV2 = mcdMonitorV2.connect(botSigner);

        const exchangeData = formatExchangeObj(
            ETH_ADDRESS,
            DAI_ADDRESS,
            repayAmount,
            uniV2WrapperAddr,
            0
        );

        const ratioBefore = await getRatio(mcdMonitorV2, cdpId);
        console.log(`Ratio of #${cdpId} before Repay is: ${ratioBefore}`);

        // send tx
        await mcdMonitorV2.repayFor(exchangeData, cdpId, 0, ETH_JOIN, { gasLimit: 8000000 });

        const ratioAfter = await getRatio(mcdMonitorV2, cdpId);
        console.log(`Ratio of #${cdpId} after Repay is: ${ratioAfter}`);
    });

});
