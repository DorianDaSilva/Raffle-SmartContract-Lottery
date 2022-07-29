//15:20:48
const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle", function () {
          let Raffle, VRFCoordinatorV2Mock, raffleEntranceFee, deployer, interval
          const chainId = network.config.chainId

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              Raffle = await ethers.getContract("Raffle", deployer)
              VRFCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffleEntranceFee = await Raffle.getEntranceFee()
              interval = await Raffle.getInterval()
          })

          describe("constructor", function () {
              it("Initializes the raffle correctly", async function () {
                  const raffleState = await Raffle.getRaffleState()
                  assert.equal(raffleState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"])
              })
          })

          describe("enterRaffle", function () {
              it("reverts when you don't pay enough", async function () {
                  await expect(Raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughETHEntered"
                  )
              })
              it("It records players when they enter", async function () {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  const playerFromcontract = await Raffle.getPlayer(0)
                  assert.equal(playerFromcontract, deployer)
              })
              it("emits event on enter", async function () {
                  await expect(Raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      Raffle,
                      "RaffleEnter"
                  )
              })
              it("doesnt allow entrance when raffle is calculating", async function () {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  //We pretend to be chainlink keeper
                  await Raffle.performUpkeep([])
                  await expect(Raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__NotOpen"
                  )
              })
          })
          describe("checkUpkeep", function () {
              it("returns false if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await Raffle.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded)
              })
              it("returns false if raffle isnt open", async function () {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await Raffle.performUpkeep([])
                  const raffleState = await Raffle.getRaffleState()
                  const { upkeepNeeded } = await Raffle.callStatic.checkUpkeep([])
                  assert.equal(raffleState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })
              it("returns false if enough time hasn't passed", async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await Raffle.callStatic.checkUpkeep([]) // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await Raffle.callStatic.checkUpkeep([]) // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(upkeepNeeded)
              })
          })
          describe("performUpkeep", function () {
              it("it can only run if checkUpkeep is true", async function () {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const tx = await Raffle.performUpkeep([])
                  assert(tx)
              })
              it("reverts when checkUpkeep is false", async function () {
                  await expect(Raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  )
              })
              it("updates the raffleState, emits an event & calls the VRFCoordinator", async function () {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await Raffle.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId
                  const raffleState = await Raffle.getRaffleState()
                  assert(requestId.toNumber() > 0)
                  assert(raffleState.toString() == 1)
              })
          })
          describe("fulfillRandomwords", function () {
              beforeEach(async function () {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("can only be called after performUpkeep", async function () {
                  await expect(
                      VRFCoordinatorV2Mock.fulfillRandomWords(0, Raffle.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      VRFCoordinatorV2Mock.fulfillRandomWords(1, Raffle.address)
                  ).to.be.revertedWith("nonexistent request")
              })
              it("picks a winner, resets the lottery & sends money", async function () {
                  //Create additional entrants using ethers fake accounts to enter lottery
                  const additionalEntrants = 3
                  const startingAccountIndex = 2 //deployer = 0
                  const accounts = await ethers.getSigners()
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      //Connect new accounts to Raffle & have these new accounts enter the lottery
                      const accountConnectedRaffle = Raffle.connect(accounts[i])
                      await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
                  }
                  const startingTimeStamp = await Raffle.getLatestTimestamp()
                  //performUpkeep (mock being chainlink keepers)
                  //Will kick off calling fulffilRandomWords (mock being chainlink VRF)
                  //We will have to wait for fulfillRandomwords to be called (simulate testnet)
                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          console.log("Found the event")
                          try {
                              const recentWinner = await Raffle.getRecentwinner()

                              console.log(recentWinner)
                              console.log(accounts[2].address)
                              console.log(accounts[0].address)
                              console.log(accounts[1].address)
                              console.log(accounts[3].address)

                              const raffleState = await Raffle.getRaffleState()
                              const endingTimeStamp = await Raffle.getLatestTimestamp()
                              const numPlayers = await Raffle.getNumberOfPlayers()
                              const winnerEndingBalance = await accounts[2].getBalance()
                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(raffleState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)
                              //Assert that winner gets entire balance added to this  Raffle contract
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      raffleEntranceFee
                                          .mul(additionalEntrants)
                                          .add(raffleEntranceFee)
                                          .toString()
                                  )
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      //setting up listener
                      //fire event, listener will pick it up & resolve
                      const tx = await Raffle.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[2].getBalance()
                      await VRFCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          Raffle.address
                      )
                  })
              })
          })
      })
