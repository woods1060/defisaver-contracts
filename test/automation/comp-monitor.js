const { changeConstantInFile } = require("../../deployers/utils/utils.js");

const dfs = require("@defisaver/sdk");
const hre = require('hardhat');

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
const ADMIN_ACC = "0xBc841B0dE0b93205e912CFBBd1D0c160A1ec6F00";
const USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const cEthAddr = "0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5";
const cUsdcAddr = "0x39AA39c021dfbaE8faC545936693aC917d5E7563";

const uniV2WrapperAddr = "0x6403BD92589F825FfeF6b62177FCe9149947cb9f";
const monitorProxyAddr = "0xB1cF8DE8e791E4Ed1Bd86c03E2fc1f14389Cb10a";

const supplyComp = async (proxy, amount) => {
    const compSupplyAddr = "0x1F22890C166B30cE8769b7B55354064C254e063F";

    await depositToWeth(amount.toString());
    await send(WETH_ADDRESS, proxy.address, amount);

    const compSupplyAction = new dfs.actions.compound.CompoundSupplyAction(
        cEthAddr,
        amount,
        proxy.address,
        true
    );

    const functionData = compSupplyAction.encodeForDsProxyCall()[1];

    await proxy["execute(address,bytes)"](compSupplyAddr, functionData, { gasLimit: 3000000 });
};

const withdrawComp = async (proxy, amount, to) => {
    const compWithdrawAddr = "0xD326a003bcfDbad0E9A4Ccc37a76Ce264345F38a";

    const compWithdrawAction = new dfs.actions.compound.CompoundWithdrawAction(
        cEthAddr,
        amount,
        to
    );
    const functionData = compWithdrawAction.encodeForDsProxyCall()[1];

    await proxy["execute(address,bytes)"](compWithdrawAddr, functionData, { gasLimit: 3000000 });
};

describe("Comp-Monitor", function() {
    this.timeout(600000);

    let senderAcc,
        proxy,
        compoundSaverFlashProxy,
        compoundSaverFlashLoan,
        compoundFlashLoanTaker,
        compoundMonitor,
        compoundLoanInfo;

    before(async () => {
        senderAcc = (await hre.ethers.getSigners())[0];
        compoundSaverFlashProxy = await deployContract("CompoundSaverFlashProxy");

        compoundLoanInfo = await deployContract("CompoundLoanInfo");

        await changeConstantInFile(
            "./contracts",
            ["CompoundSaverFlashLoan"],
            "COMPOUND_SAVER_FLASH_PROXY",
            compoundSaverFlashProxy.address
        );

        await hre.run('compile');

        compoundSaverFlashLoan = await deployContract("CompoundSaverFlashLoan");

        await changeConstantInFile(
            "./contracts",
            ["CompoundFlashLoanTaker"],
            "COMPOUND_SAVER_FLASH_LOAN",
            compoundSaverFlashLoan.address
        );

        await hre.run('compile');

        compoundFlashLoanTaker = await deployContract("CompoundFlashLoanTaker");

        compoundMonitor = await deployContract("CompoundMonitor", compoundFlashLoanTaker.address);

        await impersonateAccount(ADMIN_ACC);
        const adminSigner = await hre.ethers.provider.getSigner(ADMIN_ACC);

        const compoundProxyInstance = await hre.ethers.getContractFactory(
            "CompoundMonitorProxy",
            adminSigner
        );
        const monitorProxy = await compoundProxyInstance.attach(monitorProxyAddr);

        await monitorProxy.changeMonitor(compoundMonitor.address);

        await timeTravel(49 * 60 * 60); // move 49h

        await monitorProxy.confirmNewMonitor();
    });

    // test at block 13146320
    const compPositionAddr = "0xf93fc92519a7fc5a5951b4475bb1aeb87ea254c9";
    const supplyAmount = hre.ethers.utils.parseUnits("1", "18");
    const withdrawAmount = hre.ethers.utils.parseUnits("0.5", "18");

    const boostAmount = hre.ethers.utils.parseUnits("6000", "6");
    const repayAmount = hre.ethers.utils.parseUnits("1", "18");

    it(`... should preform an automatic boost for comp position: ${compPositionAddr}`, async () => {
        const ownerSigner = await hre.ethers.provider.getSigner(compPositionAddr);
        await impersonateAccount(compPositionAddr);

        proxy = await getProxyWithSigner(ownerSigner, compPositionAddr);
        proxy.connect(compPositionAddr);

        await supplyComp(proxy, supplyAmount);

        // simulate bot
        await impersonateAccount(BOT_ACCC);
        const botSigner = await hre.ethers.provider.getSigner(BOT_ACCC);

        compoundMonitor = compoundMonitor.connect(botSigner);

        const exchangeData = formatExchangeObj(
            USDC_ADDRESS,
            ETH_ADDRESS,
            boostAmount,
            uniV2WrapperAddr,
            0
        );

        const ratioBefore = await compoundLoanInfo.getRatio(proxy.address);
        console.log(`Ratio before boost ${ratioBefore / 1e16}`);

        // send tx
        await compoundMonitor.boostFor(exchangeData, [cEthAddr, cUsdcAddr], proxy.address, {
            gasLimit: 8000000
        });

        const ratioAfter = await compoundLoanInfo.getRatio(proxy.address);
        console.log(`Ratio after boost ${ratioAfter /  1e16}`);
    });

    it(`... should preform an automatic repay for comp position: ${compPositionAddr}`, async () => {

        const ownerSigner = await hre.ethers.provider.getSigner(compPositionAddr);
        await impersonateAccount(compPositionAddr);

        proxy = await getProxyWithSigner(ownerSigner, compPositionAddr);
        proxy.connect(compPositionAddr);

        console.log("before withdraw comp");


        await withdrawComp(proxy, withdrawAmount, senderAcc.address);

        console.log("After withdraw comp");

        await impersonateAccount(BOT_ACCC);
        const botSigner = await hre.ethers.provider.getSigner(BOT_ACCC);

        compoundMonitor = compoundMonitor.connect(botSigner);

        const exchangeData = formatExchangeObj(
            ETH_ADDRESS,
            USDC_ADDRESS,
            repayAmount,
            uniV2WrapperAddr,
            0
        );

        const ratioBefore = await compoundLoanInfo.getRatio(proxy.address);
        console.log(`Ratio before repay ${ratioBefore / 1e16}`);

        // send tx
        await compoundMonitor.repayFor(exchangeData, [cEthAddr, cUsdcAddr], proxy.address, { gasLimit: 8000000 });

        const ratioAfter = await compoundLoanInfo.getRatio(proxy.address);
        console.log(`Ratio after repay ${ratioAfter /  1e16}`);
    });
});
