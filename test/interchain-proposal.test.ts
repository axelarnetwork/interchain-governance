import { start } from "./utils/start";
import { expect } from "chai";
import { BigNumber, Contract, Wallet, providers } from "ethers";
import { ethers } from "hardhat";
import { setLogger } from "@axelar-network/axelar-local-dev";
import {
  deployComp,
  deployDummyState,
  deployGovernorAlpha,
  deployInterchainProposalExecutor,
  deployInterchainProposalSender,
  deployTimelock,
} from "./utils/deploy";
import { waitProposalExecuted } from "./utils/wait";
import { transferTimelockAdmin } from "./utils/timelock";
import { getChains } from "./utils/chains";

setLogger(() => null);

describe("Interchain Proposal", function () {
  const deployer = Wallet.createRandom();
  let sender: Contract;
  let executor: Contract;
  let comp: Contract;
  let timelock: Contract;
  let governorAlpha: Contract;
  let dummyState: Contract;
  let srcChainProvider: providers.JsonRpcProvider;

  // redefine "slow" test for this test suite
  this.slow(10000);

  before(async function () {
    // Start local chains
    await start([deployer.address]);
    srcChainProvider = new ethers.providers.JsonRpcProvider(getChains()[0].rpc);

    // Deploy contracts
    sender = await deployInterchainProposalSender(deployer);
    executor = await deployInterchainProposalExecutor(deployer);
    comp = await deployComp(deployer);
    timelock = await deployTimelock(deployer);
    governorAlpha = await deployGovernorAlpha(
      deployer,
      timelock.address,
      comp.address
    );

    // Transfer ownership of the Timelock contract to the Governor contract
    await transferTimelockAdmin(timelock, governorAlpha.address);

    // Complete the Timelock contract ownership transfer
    await governorAlpha.__acceptAdmin();

    dummyState = await deployDummyState(deployer);

    // Transfer ownership of the InterchainProposalSender to the Timelock contract
    await sender.transferOwnership(timelock.address);
  });

  it("should be able to execute a proposal with to a single target contract", async function () {
    // Encode the payload for the destination chain
    const payload = ethers.utils.defaultAbiCoder.encode(
      ["address[]", "uint256[]", "string[]", "bytes[]"],
      [
        [dummyState.address],
        [0],
        ["setState(string)"],
        [ethers.utils.defaultAbiCoder.encode(["string"], ["Hello World"])],
      ]
    );

    // Delegate votes the COMP token to the deployer
    await comp.delegate(deployer.address);

    // Propose the payload to the Governor contract
    await governorAlpha.propose(
      [sender.address],
      [ethers.utils.parseEther("0.0001")],
      ["executeRemoteProposal(string,string,bytes)"],
      [
        ethers.utils.defaultAbiCoder.encode(
          ["string", "string", "bytes"],
          ["Avalanche", executor.address, payload]
        ),
      ],
      { value: ethers.utils.parseEther("0.0001") }
    );

    const proposalId = await governorAlpha.latestProposalIds(deployer.address);
    console.log("Created Proposal ID:", proposalId.toString());

    // Advance time to the proposal's start block
    const votingDelay = await governorAlpha.votingDelay();
    await srcChainProvider.send("evm_mine", [
      { blocks: votingDelay.toString() },
    ]);

    // Cast vote for the proposal
    await governorAlpha.castVote(proposalId, true);
    const compBalance = await comp.balanceOf(deployer.address);
    console.log(
      "Casted Vote with",
      ethers.utils.formatEther(compBalance),
      "COMP"
    );

    // Advance time to the proposal's end block
    const votingPeriod = await governorAlpha.votingPeriod();
    await srcChainProvider.send("evm_mine", [
      { blocks: votingPeriod.toString() },
    ]);

    // Read proposal state
    const proposalState = await governorAlpha.state(proposalId);

    // Expect proposal to be in the succeeded state
    expect(proposalState).to.equal(4);

    // Queue the proposal
    await governorAlpha.queue(proposalId);
    console.log("Queued Proposal ID:", proposalId.toString());

    const delay = await timelock
      .delay()
      .then((delay: BigNumber) => delay.toHexString());

    // Advance time to the proposal's eta
    await srcChainProvider.send("evm_increaseTime", [delay]);

    // Execute the proposal
    await governorAlpha.execute(proposalId, {
      value: ethers.utils.parseEther("0.0001"),
    });
    console.log("Executed Proposal ID:", proposalId.toString());

    // Wait for the proposal to be executed on the destination chain
    await waitProposalExecuted(payload, executor);

    // Expect the dummy state to be updated
    await expect(await dummyState.message()).to.equal("Hello World");
  });

  it.only("should be able to execute a proposal with to multiple target contracts", async function () {
    const dummyState2 = await deployDummyState(deployer);
    const dummyState3 = await deployDummyState(deployer);

    const encodeMsg = (msg: string) =>
      ethers.utils.defaultAbiCoder.encode(["string"], [msg]);

    // Encode the payload for the destination chain
    const payload = ethers.utils.defaultAbiCoder.encode(
      ["address[]", "uint256[]", "string[]", "bytes[]"],
      [
        [dummyState.address, dummyState2.address, dummyState3.address],
        [0, 0, 0],
        ["setState(string)", "setState(string)", "setState(string)"],
        [
          encodeMsg("Hello World1"),
          encodeMsg("Hello World2"),
          encodeMsg("Hello World3"),
        ],
      ]
    );

    // Delegate votes the COMP token to the deployer
    await comp.delegate(deployer.address);

    // Propose the payload to the Governor contract
    await governorAlpha.propose(
      [sender.address],
      [ethers.utils.parseEther("0.0001")],
      ["executeRemoteProposal(string,string,bytes)"],
      [
        ethers.utils.defaultAbiCoder.encode(
          ["string", "string", "bytes"],
          ["Avalanche", executor.address, payload]
        ),
      ],
      { value: ethers.utils.parseEther("0.0001") }
    );

    const proposalId = await governorAlpha.latestProposalIds(deployer.address);
    console.log("Created Proposal ID:", proposalId.toString());

    // Advance time to the proposal's start block
    const votingDelay = await governorAlpha.votingDelay();
    await srcChainProvider.send("evm_mine", [
      { blocks: votingDelay.toString() },
    ]);

    // Cast vote for the proposal
    await governorAlpha.castVote(proposalId, true);
    const compBalance = await comp.balanceOf(deployer.address);
    console.log(
      "Casted Vote with",
      ethers.utils.formatEther(compBalance),
      "COMP"
    );

    // Advance time to the proposal's end block
    const votingPeriod = await governorAlpha.votingPeriod();
    await srcChainProvider.send("evm_mine", [
      { blocks: votingPeriod.toString() },
    ]);

    // Read proposal state
    const proposalState = await governorAlpha.state(proposalId);

    // Expect proposal to be in the succeeded state
    expect(proposalState).to.equal(4);

    // Queue the proposal
    await governorAlpha.queue(proposalId);
    console.log("Queued Proposal ID:", proposalId.toString());

    const delay = await timelock
      .delay()
      .then((delay: BigNumber) => delay.toHexString());

    // Advance time to the proposal's eta
    await srcChainProvider.send("evm_increaseTime", [delay]);

    // Execute the proposal
    await governorAlpha.execute(proposalId, {
      value: ethers.utils.parseEther("0.0001"),
    });
    console.log("Executed Proposal ID:", proposalId.toString());

    // Wait for the proposal to be executed on the destination chain
    await waitProposalExecuted(payload, executor);

    expect(await dummyState.message()).to.equal("Hello World1");
    expect(await dummyState2.message()).to.equal("Hello World2");
    expect(await dummyState3.message()).to.equal("Hello World3");
  });
});