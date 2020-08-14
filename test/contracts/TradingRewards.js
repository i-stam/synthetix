const cloneDeep = require('lodash.clonedeep');
const { artifacts, contract, web3 } = require('@nomiclabs/buidler');
const { assert } = require('./common');
const { ensureOnlyExpectedMutativeFunctions } = require('./helpers');
const { mockToken } = require('./setup');
const { toWei, toBN, isHex } = web3.utils;
const {
	toUnit,
	fromUnit,
	divideDecimal,
	multiplyDecimal,
	takeSnapshot,
	restoreSnapshot,
} = require('../utils')();
// TODO: remove unused

const TradingRewards = artifacts.require('TradingRewards');

contract('TradingRewards', accounts => {
	const [
		deployerAccount,
		owner,
		rewardsDistribution,
		account1,
		account2,
		account3,
		account4,
		account5,
		account6,
		account7,
	] = accounts;

	const rewardsTokenTotalSupply = '1000000';

	let token, rewards;

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: TradingRewards.abi,
			ignoreParents: ['Owned', 'Pausable'],
			expected: [
				'claimRewardsForPeriod',
				'claimRewardsForPeriods',
				'recordExchangeFeeForAccount',
				'setRewardsDistribution',
				'notifyRewardAmount',
				'recoverTokens',
				'recoverRewardsTokens',
			],
		});
	});

	describe('when deploying a rewards token', () => {
		before('deploy rewards token', async () => {
			({ token } = await mockToken({
				accounts,
				name: 'Rewards Token',
				symbol: 'RWD',
				supply: rewardsTokenTotalSupply,
			}));
		});

		it('has the correct decimals settings', async () => {
			assert.equal('18', await token.decimals());
		});

		it('has the correct total supply', async () => {
			assert.equal(toWei(rewardsTokenTotalSupply), await token.totalSupply());
		});

		it('supply is held by owner', async () => {
			assert.equal(toWei(rewardsTokenTotalSupply), await token.balanceOf(owner));
		});

		describe('when the TradingRewards contract is deployed', () => {
			before('deploy rewards contract', async () => {
				rewards = await TradingRewards.new(owner, token.address, rewardsDistribution, {
					from: deployerAccount,
				});
			});

			it('has the correct rewards token set', async () => {
				assert.equal(token.address, await rewards.getRewardsToken());
			});

			it('has the correct rewardsDistribution address set', async () => {
				assert.equal(rewardsDistribution, await rewards.getRewardsDistribution());
			});

			it('has the correct owner set', async () => {
				assert.equal(owner, await rewards.owner());
			});

			describe('before period 1 is created (while in period 0)', () => {
				itHasConsistentState();
				itHasConsistentStateForPeriod({ periodID: 0 });

				it('reverts when trying to record fees', async () => {
					await assert.revert(
						rewards.recordExchangeFeeForAccount(10, account1),
						'No period available'
					);
				});

				it('reverts when attempting to create a new period with no rewards balance', async () => {
					await assert.revert(
						rewards.notifyRewardAmount(10, { from: rewardsDistribution }),
						'Insufficient free rewards'
					);
				});
			});

			describe('when 10000 reward tokens are transferred to the contract', () => {
				before('transfer the reward tokens to the contract', async () => {
					await helper.depositRewards({ amount: 10000 });
				});

				it('holds the transferred tokens', async () => {
					assert.equal(toWei('10000'), await token.balanceOf(rewards.address));
				});

				it('reverts when any account attempts to create a new period', async () => {
					await assert.revert(
						rewards.notifyRewardAmount('10', { from: account1 }),
						'Caller not RewardsDistribution'
					);
				});

				it('reverts when there is not enough rewards balance for the creation of a period', async () => {
					await assert.revert(
						rewards.notifyRewardAmount(toWei('50000'), { from: rewardsDistribution }),
						'Insufficient free rewards'
					);
				});

				itHasConsistentState();

				describe('when period 1 is created', () => {
					before('create the period', async () => {
						await helper.createPeriod({
							amount: 10000,
						});
					});

					itHasConsistentState();
					itHasConsistentStateForPeriod({ periodID: 1 });

					describe('when transactions fees are recoded in period 1', () => {
						before('record fees', async () => {
							await helper.recordFee({ account: account1, fee: 10, periodID: 1 });
							await helper.recordFee({ account: account2, fee: 130, periodID: 1 });
							await helper.recordFee({ account: account3, fee: 4501, periodID: 1 });
							await helper.recordFee({ account: account4, fee: 1337, periodID: 1 });
							await helper.recordFee({ account: account5, fee: 1, periodID: 1 });
						});

						itHasConsistentStateForPeriod({ periodID: 1 });

						// TODO
						// it('reverts when any of the accounts attempt to withdraw from period 0', async () => {
						// });

						describe('when 5000 more reward tokens are transferred to the contract', () => {
							before('transfer the reward tokens to the contract', async () => {
								await helper.depositRewards({ amount: 5000 });
							});

							it('reverts if trying to create a period with more rewards than those available', async () => {
								await assert.revert(
									rewards.notifyRewardAmount(toUnit('5001'), {
										from: rewardsDistribution,
									}),
									'Insufficient free rewards'
								);
							});

							describe('when period 2 is created', () => {
								before('create the period', async () => {
									await helper.createPeriod({
										amount: 5000,
									});
								});

								itHasConsistentState();
								itHasConsistentStateForPeriod({ periodID: 2 });

								describe('when claiming all rewards for period 1', () => {
									before(async () => {
										await helper.takeSnapshot();
									});

									before('claim rewards by all accounts that recorded fees', async () => {
										await helper.claimRewards({ account: account1, periodID: 1 });
										await helper.claimRewards({ account: account2, periodID: 1 });
										await helper.claimRewards({ account: account3, periodID: 1 });
										await helper.claimRewards({ account: account4, periodID: 1 });
										await helper.claimRewards({ account: account5, periodID: 1 });
									});

									after(async () => {
										await helper.restoreSnapshot();
									});

									itHasConsistentState();
									itHasConsistentStateForPeriod({ periodID: 1 });
									itHasConsistentStateForPeriod({ periodID: 2 });

									it('reverts if accounts that claimed attempt to claim again', async () => {
										await assert.revert(
											rewards.claimRewardsForPeriod(1, { from: account1 }),
											'No rewards claimable'
										);
										await assert.revert(
											rewards.claimRewardsForPeriod(1, { from: account2 }),
											'No rewards claimable'
										);
									});

									it(`reverts when accounts that did not record fees in period 1 attempt to claim rewards`, async () => {
										await assert.revert(
											rewards.claimRewardsForPeriod(1, { from: account6 }),
											'No rewards claimable'
										);
										await assert.revert(
											rewards.claimRewardsForPeriod(1, { from: account7 }),
											'No rewards claimable'
										);
									});
								});

								describe('when partially claiming rewards for period 1', () => {
									before('claim rewards by some accounts that recorded fees', async () => {
										await helper.claimRewards({ account: account1, periodID: 1 });
										await helper.claimRewards({ account: account2, periodID: 1 });
										await helper.claimRewards({ account: account3, periodID: 1 });
										// Note: Intentionally not claiming rewards for account4.
										await helper.claimRewards({ account: account5, periodID: 1 });
									});

									itHasConsistentState();
									itHasConsistentStateForPeriod({ periodID: 1 });
									itHasConsistentStateForPeriod({ periodID: 2 });

									describe('when transaction fees are recoreded in period 2', () => {
										before('record fees', async () => {
											await helper.recordFee({ account: account4, fee: 10000, periodID: 2 });
											await helper.recordFee({ account: account6, fee: 42, periodID: 2 });
											await helper.recordFee({ account: account7, fee: 1, periodID: 2 });
										});

										itHasConsistentState();
										itHasConsistentStateForPeriod({ periodID: 2 });

										describe('when 15000 more reward tokens are transferred to the contract', () => {
											before('transfer the reward tokens to the contract', async () => {
												await helper.depositRewards({ amount: 15000 });
											});

											describe('when period 3 is created', () => {
												before('create the period', async () => {
													await helper.createPeriod({
														amount: 15000,
													});
												});

												itHasConsistentState();
												itHasConsistentStateForPeriod({ periodID: 3 });

												it('properly reports accumulated available rewards', async () => {
													assert.bnEqual(
														await rewards.getAvailableRewardsForAccountForPeriods(account4, [1, 2]),
														helper.calculateMultipleRewards({
															account: account4,
															periodIDs: [1, 2],
														})
													);
												});

												describe('when some accounts claim rewards on period 2', () => {
													before(async () => {
														await helper.claimRewards({ account: account6, periodID: 2 });
														await helper.claimRewards({ account: account7, periodID: 2 });
													});

													itHasConsistentState();
													itHasConsistentStateForPeriod({ periodID: 2 });
												});

												describe('when an account claims rewards for multiple periods', () => {
													before(async () => {
														await helper.claimMultipleRewards({
															account: account4,
															periodIDs: [1, 2],
														});
													});

													itHasConsistentState();
													itHasConsistentStateForPeriod({ periodID: 1 });
													itHasConsistentStateForPeriod({ periodID: 2 });
												});
											});
										});
									});
								});
							});
						});
					});
				});
			});
		});
	});
});
