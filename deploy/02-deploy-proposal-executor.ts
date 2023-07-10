import { DeployFunction } from "hardhat-deploy/dist/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deploy3 } from "../scripts/deploy";
import { contracts } from "../constants";

const contractName = "InterchainProposalExecutor";
const deploy: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const [deployer] = await hre.getUnnamedAccounts();
  const { gateway } = contracts[hre.network.name];
  await deploy3(hre, contractName, deployer + "v1", [gateway, deployer]);
};

deploy.tags = [contractName];
deploy.dependencies = ["Deployer"];

export default deploy;
