import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedUsdt = await deploy("fakeUSDT", {
    from: deployer,
    log: true,
  });

  const deployedZama = await deploy("fakeZama", {
    from: deployer,
    log: true,
  });

  const deployedSwap = await deploy("StealthSwap", {
    from: deployer,
    log: true,
    args: [deployedUsdt.address, deployedZama.address],
  });

  console.log("fUSDT contract:", deployedUsdt.address);
  console.log("fZama contract:", deployedZama.address);
  console.log("StealthSwap contract:", deployedSwap.address);
};

export default func;
func.id = "deploy_stealthswap";
func.tags = ["StealthSwap"];
