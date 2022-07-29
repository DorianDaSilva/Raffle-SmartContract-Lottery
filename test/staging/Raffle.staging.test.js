//16:08:47
const { assert, expect } = require("chai")
const { getNamedAccounts, ethers, network } = require("hardhat")
const { developmentChains } = require("../../helper-hardhat-config")

developmentChains.includes(network.name)
    ? describe
    : describe("Raffle", function () {
          let Raffle, raffleEntranceFee, deployer

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              Raffle = await ethers.getContract("Raffle", deployer)
              raffleEntranceFee = await Raffle.getEntranceFee()
          })
          describe("fulfillRandomWords", function () {
              it("works with live Chainlink keepers & Chainlink VRF, we get random winner", async function () {
                  //enter the Raffle
                  console.log("Setting up test...")
                  const startingTimeStamp = await Raffle.getLatestTimestamp()
                  const accounts = await ethers.getSigners()
                  console.log("Setting up Listener...")

                  await new Promise(async function () {
                      //set up listener before we enter the raffle
                      Raffle.once("WinnerPicked", async function(resolve, reject) {
                          console.log("WinnerPicked event fired")
                          try {
                              //asserts
                              console.log("Made it here!!!")
                              const recentWinner = await Raffle.getRecentWinner()
                              const raffleState = await Raffle.getRaffleState()
                              const winnerEndingBalance = await accounts[0].getBalance()
                              const endingTimeStamp = await Raffle.getLatestTimestamp()

                              await expect(Raffle.getPlayer(0)).to.be.reverted
                              assert.equal(recentWinner.toString(), accounts[0].address) //deployer
                              assert.equal(raffleState, 0)
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(raffleEntranceFee).toString()
                              )
                              assert(endingTimeStamp > startingTimeStamp)
                              resolve()
                          } catch (e) {
                              console.log(e)
                              reject(e)
                          }
                      })
                      //entering the raffle
                      console.log("Entering Raffle...")
                      await Raffle.enterRaffle({ value: raffleEntranceFee })
                      console.log("Time to wait...")
                      const winnerStartingBalance = await accounts[0].getBalance()
                      console.log("Listening to new promise...")
                      //Code won't complete until listener is done
                  })
              })
          })
      })
