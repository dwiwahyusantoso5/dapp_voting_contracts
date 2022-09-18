const Web3 = require("web3");
const web3 = new Web3(new Web3.providers.HttpProvider("http://localhost:8545"));
const assert = require("assert");
const eVote = artifacts.require("eVote.sol");
const crypto = artifacts.require("Crypto.sol");
const { MerkleTree } = require("../helper/merkletree.js");
const prover = require("../helper/prover.js");
const {
  mineToBlockNumber,
  takeSnapshot,
  revertToSnapshot,
} = require("../helper/truffleHelper.js");
const { keccak256 } = require("ethereumjs-util");
const random = require("crypto");
const abi = require("ethereumjs-abi");
const EC = require("elliptic").ec;
var group = new EC("bn256");

contract("eVote", async (accounts) => {
  let admin = accounts[0];
  log = "";
  data = prover.genTestData(accounts.length - 2);
  hypo = [];
  for (i = 0; i < 256; i++) hypo.push(keccak256(i));
  let usersMerkleTree = new MerkleTree(accounts.slice(1, accounts.length - 1));
  let eVoteInstance;
  it("Deploy the contracts", async () => {
    eVoteInstance = await eVote.deployed();
  });

  it("Register public keys for elligable users", async () => {
    for (let i = 0; i < data.length; i++) {
      _merkleProof = usersMerkleTree.getHexProof(accounts[i + 1]);
      tx = await eVoteInstance.registerVoter(
        [data[i].xG.getX(), data[i].xG.getY()],
        data[i].proofDL,
        _merkleProof,
        { from: accounts[i + 1], value: web3.utils.toWei("1", "ether") }
      );
    }
    log += `\nRegisterVote: ${tx.receipt.gasUsed.toString()}\n`;
  });

  it("Throw an error if non-elligable user tries to vote", async () => {
    snapShot = await takeSnapshot();
    snapshotId = snapShot["result"];
    _merkleProof = usersMerkleTree.getHexProof(accounts[accounts.length - 2]);
    try {
      await eVoteInstance.registerVoter(
        [data[0].xG.getX(), data[0].xG.getY()],
        data[0].proofDL,
        _merkleProof,
        {
          from: accounts[accounts.length - 1],
          value: web3.utils.toWei("1", "ether"),
        }
      );
    } catch (err) {
      assert(
        String(err).includes("Invalid Merkle proof"),
        "error in verifying invalid user"
      );
    }
    await revertToSnapshot(snapshotId);
  });

  it("Cast valid votes", async () => {
    beginVote = (
      await eVoteInstance.finishRegistartionBlockNumber.call()
    ).toNumber();
    await mineToBlockNumber(beginVote);
    for (let i = 0; i < data.length; i++)
      tx = await eVoteInstance.castVote(
        [data[i].c.getX(), data[i].c.getY()],
        [data[i].Y.getX(), data[i].Y.getY()],
        data[i].proof01,
        { from: accounts[i + 1] }
      );
    log += `CastVote: ${tx.receipt.gasUsed.toString()}\n`;
  });

  it("Honest Administrator", async () => {
    computationArray = [];
    beginTally = (
      await eVoteInstance.finishVotingBlockNumber.call()
    ).toNumber();
    await mineToBlockNumber(beginTally);
    let tempComputationArray = [data[0].c];
    //compute the tally and add inputs to the circuit
    for (let i = 1; i < data.length; i++)
      tempComputationArray.push(data[i].c.add(tempComputationArray[i - 1]));

    vote = -1;
    for (i = 0; i < data.length; i++) {
      f = group.g.mul(i);
      if (
        tempComputationArray[tempComputationArray.length - 1].eq(group.g.mul(i))
      ) {
        vote = i;
        break;
      }
    }
    assert(vote >= 0, "Couldn't brute-force the vote result");
    //encode the computation trace and accumulate it by a Merkle tree
    for (let i = 0; i < tempComputationArray.length; i++)
      computationArray.push(
        abi.rawEncode(
          ["uint[3]"],
          [[i, tempComputationArray[i].getX(), tempComputationArray[i].getY()]]
        )
      );

    computationMerkleTree = new MerkleTree(computationArray);
    tx = await eVoteInstance.setTallyResult(
      vote,
      computationMerkleTree.getHexRoot(),
      { from: admin }
    );
    log += `SetTallyResult: ${tx.receipt.gasUsed.toString()}\n`;
    console.log(log);
  });
});
