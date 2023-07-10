const { ethers } = require('hardhat');
const { contracts } = require('../../constants');
const { chains } = require('../../constants/chains');
const { expect } = require('chai');

describe('Proposal Executor', function () {
  let executor;
  let signer;
  let signerAddress;
  let dummy;

  // redefine "slow" test for this test suite
  this.slow(10000);
  this.timeout(15000);

  beforeEach(async () => {
    [signer] = await ethers.getSigners();
    signerAddress = await signer.getAddress();
    const executorFactory = await ethers.getContractFactory(
      'TestProposalExecutor',
    );
    executor = await executorFactory.deploy(
      contracts[chains.hardhat].gateway,
      signerAddress,
    );

    const dummyStateFactory = await ethers.getContractFactory('DummyState');

    dummy = await dummyStateFactory.deploy();

    gateway = await ethers.getContractAt(
      'IAxelarGateway',
      contracts[chains.hardhat].gateway,
    );
  });

  describe('proposal execute', function () {
    it('should be able to call target contract', async function () {
      // whitelist caller and sender
      await executor.setWhitelistedProposalCaller(
        chains.ethereum,
        signerAddress,
        true,
      );
      await executor.setWhitelistedProposalSender(
        chains.ethereum,
        signerAddress,
        true,
      );

      const callData = dummy.interface.encodeFunctionData('setState', [
        'Hello World',
      ]);
      const calls = [
        {
          target: dummy.address,
          value: 0,
          callData,
        },
      ];

      const payload = ethers.utils.defaultAbiCoder.encode(
        ['address', 'tuple(address target, uint256 value, bytes callData)[]'],
        [signerAddress, calls],
      );

      const broadcast = () =>
        executor.forceExecute(chains.ethereum, signerAddress, payload);

      await expect(broadcast())
        .to.emit(executor, 'BeforeProposalExecuted(string,string,bytes)')
        .withArgs(chains.ethereum, signerAddress, payload);

      await expect(broadcast())
        .to.emit(executor, 'TargetExecuted(address,uint256,bytes)')
        .withArgs(calls[0].target, calls[0].value, calls[0].callData);

      await expect(broadcast())
        .to.emit(executor, 'ProposalExecuted(bytes32)')
        .withArgs(
          ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
              ['string', 'string', 'address', 'bytes'],
              [chains.ethereum, signerAddress, signerAddress, payload],
            ),
          ),
        );
    });

    it('should revert properly when execution failed', async function () {
      // whitelist caller and sender
      await executor.setWhitelistedProposalCaller(
        chains.ethereum,
        signerAddress,
        true,
      );
      await executor.setWhitelistedProposalSender(
        chains.ethereum,
        signerAddress,
        true,
      );

      const getPayload = (failedWithReason) => {
        const failedCallData = dummy.interface.encodeFunctionData('setState', [
          'Hello World',
        ]);
        const failedCallDataWithReason =
          dummy.interface.encodeFunctionData('testRevert');

        const calls = [
          {
            target: dummy.address,
            value: failedWithReason ? 0 : 1,
            callData: failedWithReason
              ? failedCallDataWithReason
              : failedCallData,
          },
        ];

        const payload = ethers.utils.defaultAbiCoder.encode(
          ['address', 'tuple(address target, uint256 value, bytes callData)[]'],
          [signerAddress, calls],
        );

        return payload;
      };

      const broadcast = (payload) =>
        executor.forceExecute(chains.ethereum, signerAddress, payload);

      await expect(broadcast(getPayload(true))).to.be.revertedWith('kaboom');
      await expect(broadcast(getPayload(false))).to.be.revertedWithCustomError(
        executor,
        'ProposalExecuteFailed',
      );
    });

    it("should revert when the sender hasn't been whitelisted", async function () {
      const callData = dummy.interface.encodeFunctionData('setState', [
        'Hello World',
      ]);
      const calls = [
        {
          target: dummy.address,
          value: 0,
          callData,
        },
      ];

      const payload = ethers.utils.defaultAbiCoder.encode(
        ['address', 'tuple(address target, uint256 value, bytes callData)[]'],
        [signerAddress, calls],
      );

      const broadcast = () =>
        executor.forceExecute(chains.ethereum, signerAddress, payload);

      await expect(broadcast()).to.be.revertedWithCustomError(
        executor,
        'NotWhitelistedSourceAddress',
      );
    });

    it("should revert when the caller hasn't been whitelisted", async function () {
      await executor.setWhitelistedProposalSender(
        chains.ethereum,
        signerAddress,
        true,
      );

      const callData = dummy.interface.encodeFunctionData('setState', [
        'Hello World',
      ]);

      const calls = [
        {
          target: dummy.address,
          value: 0,
          callData,
        },
      ];

      const payload = ethers.utils.defaultAbiCoder.encode(
        ['address', 'tuple(address target, uint256 value, bytes callData)[]'],
        [signerAddress, calls],
      );

      const broadcast = () =>
        executor.forceExecute(chains.ethereum, signerAddress, payload);

      await expect(broadcast()).to.be.revertedWithCustomError(
        executor,
        'NotWhitelistedCaller',
      );
    });
  });
});
