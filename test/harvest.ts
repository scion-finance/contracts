import { expect } from 'chai';
import { ethers, getNamedAccounts, deployments, network } from 'hardhat';
import {
  forkNetwork,
  approve,
  setupAccount,
  setMiningInterval,
  deadline,
  getTvl,
  copyDeployments,
  getVault,
  forkBlock,
  chain,
} from '../utils';
import { getUniAddr } from '@sc1/common/utils/address';
import { IChain } from '@sc1/common/utils';
import { getHarvestParams, strategies, IStrat } from '@sc1/common/strategies';

const { getSigner } = ethers;

const initStrat = async (strat: IStrat) => {
  const { deployer } = await getNamedAccounts();
  await setupAccount(deployer);

  const vault = await getVault();
  await approve(strat.underlying, deployer, vault.address);

  const router = getUniAddr('UNISWAP_ROUTER', strat.swap);
  await approve(strat.underlying, deployer, router);

  const strategy = await ethers.getContract(strat.symbol, deployer);
  const dec = await strategy.decimals();
  return { strategy, dec };
};

// runs tests for all strategies
strategies
  .filter((s) => s.chain === chain)
  // .slice(0, 1)
  // .filter((s) => s.symbol === 'USDCavaxJOEqi')
  .forEach((strat) => {
    describe(strat.symbol, function () {
      this.timeout(220000); // fantom is slow

      let owner;
      let managerSig;
      let strategy;
      let dec;

      before(async () => {
        await forkNetwork(chain, forkBlock[chain]);
        await setMiningInterval(0);
        await copyDeployments(chain);
        await deployments.run(['Timelock', 'TimelockStrat'], {
          resetMemory: false,
          deletePreviousDeployments: false,
          writeDeploymentsToFiles: false,
        });
        await network.provider.send('evm_increaseTime', [1 * 24 * 60 * 60]);

        const { deployer, manager } = await getNamedAccounts();
        await setupAccount(deployer);
        await setupAccount(manager);
        managerSig = await getSigner(manager);
        ({ strategy, dec } = await initStrat(strat));
      });

      it('harvest', async function () {
        console.log('strat', strat.symbol, strategy.address);
        await getTvl(strategy);
        const harvestArgs = await getHarvestParams(
          strategy,
          strat,
          managerSig,
          deadline()
        );

        // const swapParamsStatic = strat.farmPaths.map((path) => [
        //   path,
        //   0,
        //   deadline(),
        // ]);
        // const tx = await strategy
        //   .connect(managerSig)
        //   .harvest(swapParamsStatic, []);

        // console.log('harvestArgs', harvestArgs);
        const tx = await strategy.connect(managerSig).harvest(...harvestArgs);
        const res = await tx.wait();

        const harvestLog = res.events.find((e) => e.event === 'Harvest');
        const harvestToken = res.events.filter(
          (e) => e.event === 'HarvestedToken'
        );

        // const iface = new ethers.utils.Interface([
        //   'event Transfer (address indexed from, address indexed to, uint256 amount)',
        // ]);

        // res.logs.forEach((e) => {
        //   try {
        //     console.log(iface.parseLog(e));
        //     console.log(iface.parseLog(e).args.amount.toString());
        //   } catch (err) {
        //     //
        //   }
        // });

        console.log(
          'HarvestedToken',
          harvestToken.map((h) => h.args.map((b) => b.toString()))
        );

        const tvl = await strategy.getTotalTVL();
        console.log('harvested', tvl.sub(harvestLog.args.harvested).toString());
      });
    });
  });
