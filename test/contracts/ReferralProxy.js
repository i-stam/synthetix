'use strict';

const { contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { toUnit, currentTime } = require('../utils')();

const { setupAllContracts } = require('./setup');

const { ensureOnlyExpectedMutativeFunctions } = require('./helpers');

const {
	toBytes32,
	constants: { ZERO_ADDRESS },
} = require('../..');

contract('ReferralProxy', async accounts => {
	const sETH = toBytes32('sETH');
	const sBTC = toBytes32('sBTC');

	const numberOfReferrals = 1;

	const [, owner, oracle, account1, account2] = accounts;

	let tx;

	let addressResolver, exchangeRates, synths, referralProxy;

	const updateRatesWithDefaults = async () => {
		const timestamp = await currentTime();

		await exchangeRates.updateRates([sETH], ['100'].map(toUnit), timestamp, {
			from: oracle,
		});

		await exchangeRates.updateRates([sBTC], ['10000'].map(toUnit), timestamp, {
			from: oracle,
		});
	};

	const setupReferralProxy = async () => {
		synths = ['sUSD', 'sBTC'];
		({
			ExchangeRates: exchangeRates,
			AddressResolver: addressResolver,
			ReferralProxy: referralProxy,
		} = await setupAllContracts({
			accounts,
			synths,
			contracts: [
				'Synthetix',
				'AddressResolver',
				'Exchanger',
				'ExchangeRates',
				'SystemStatus',
				'ReferralProxy',
			],
		}));

		await addressResolver.importAddresses([toBytes32('ReferralProxy')], [referralProxy.address], {
			from: owner,
		});
	};

	before(async () => {
		await setupReferralProxy();
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		await updateRatesWithDefaults();
	});

	it('should ensure only expected functions are mutative', async () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: referralProxy.abi,
			ignoreParents: ['Owned', 'MixinResolver', 'ERC721'],
			expected: [
				'issueReferrals',
				'sendReferral',
				'exchangeWithReferral',
				'claimReferralRewards',
				'takeSnapshot',
			],
		});
	});

	describe('issue referral', async () => {
		it('should issue referrals and emit the ReferralsIssued event', async () => {
			tx = await referralProxy.issueReferrals(account1, numberOfReferrals, {
				from: owner,
			});

			assert.eventEqual(tx, 'Transfer', {
				from: ZERO_ADDRESS,
				to: account1,
				tokenId: 1,
			});

			// assert.eventEqual(tx, 'ReferralsIssued', {
			// 	_to: account1,
			// 	_amount: numberOfReferrals,
			// });
		});
	});

	describe('send referral', async () => {
		beforeEach(async () => {
			await referralProxy.issueReferrals(account1, numberOfReferrals, {
				from: owner,
			});
		});

		it('should send a referral to the recipient', async () => {
			tx = await referralProxy.sendReferral(account2, 1, {
				from: account1,
			});

			assert.eventEqual(tx, 'Transfer', {
				from: account1,
				to: account2,
				tokenId: 1,
			});
		});

		// it('should revert if the user already exists', async () => {
		// 	await assert.revert(
		// 		referralProxy.sendReferral(account2, 1, { from: account1 }),
		// 		'User exists'
		// 	);
		// });
	});

	// describe('exchange with referral', async () => {
	// 	beforeEach(async () => {

	// 	});

	// 	it('should perform an exchange and redeem the referral', async () => {

	// 	});
	// });
});
