const dotenv           = require('dotenv').config();
require('@nomiclabs/hardhat-ethers');

module.exports = {
    networks: {
        local: {
            url: 'http://127.0.0.1:8545',
            timeout: 1000000,
            gasPrice: 70000000000,
        },
        fork: {
            url: `https://rpc.tenderly.co/fork/${process.env.FORK_ID}`,
            timeout: 1000000,
        },
        hardhat: {
            forking: {
                url: process.env.ETHEREUM_NODE,
                timeout: 1000000,
                // blockNumber: 12068716
            },
        },
        mainnet: {
            url: process.env.ETHEREUM_NODE,
            accounts: [process.env.PRIV_KEY_MAINNET],
            gasPrice: 40000000000,
            timeout: 10000000,
        },
        kovan: {
            url: process.env.KOVAN_ETHEREUM_NODE,
            chainId: 42,
            accounts: [process.env.PRIV_KEY_KOVAN],
        },
    },
    solidity: {
        version: "0.6.12",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        },
    },
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts"
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY
    }
};
