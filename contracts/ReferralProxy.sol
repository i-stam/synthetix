pragma solidity ^0.5.16;

// Inheritance
import "./MixinResolver.sol";
import "./Owned.sol";

// Internal references
import "./interfaces/ISynthetix.sol";
import "./interfaces/IERC20.sol";

// External dependencies.
import "openzeppelin-solidity-2.3.0/contracts/token/ERC721/ERC721.sol";

contract ReferralProxy is MixinResolver, Owned, ERC721 {
    uint256 public constant REFERRAL_EXPIRATION = 30 days;
    uint256 public constant TRADING_WINDOW = 30 days;
    uint256 public constant SNAPSHOT_FREQUENCY = 30 days;
    uint256 public constant LOCKDOWN_WINDOW = 30 days;
    uint public constant TIER1_VOLUME = 1000000 wei;
    uint public constant TIER1_REWARDS = 100 wei; // in SNX

    bytes32 private constant sUSD = "sUSD";
    bytes32 private constant CONTRACT_SYNTHETIX = "Synthetix";

    uint public issuedReferrals = 1; //hack so we dont assign id 0 which is used as "no referral"
    uint public nextSnapshot;

    mapping(uint => uint) public referralActivation;
    mapping(address => uint) public existingUsers;
    mapping(uint => address) public referralOrigin;
    mapping(address => uint) public volume;
    mapping(address => uint) public whenClaim;

    // ========== CONSTRUCTOR ==========

    constructor(address owner, address _resolver) public Owned(owner) MixinResolver(_resolver) {
        nextSnapshot = block.timestamp.add(SNAPSHOT_FREQUENCY);
    }

    function synthetix() internal view returns (ISynthetix) {
        return ISynthetix(requireAndGetAddress(CONTRACT_SYNTHETIX));
    }

    function synthetixERC20() internal view returns (IERC20) {
        return IERC20(requireAndGetAddress(CONTRACT_SYNTHETIX));
    }

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        addresses = new bytes32[](1);
        addresses[0] = CONTRACT_SYNTHETIX;
    }

    function issueReferrals(address _to, uint _amount) external onlyOwner {
        uint issuedUpdated = issuedReferrals.add(_amount);
        for (uint i = issuedReferrals; i < issuedUpdated; i++) {
            _mint(_to, i);
            referralOrigin[i] = _to;
        }
        issuedReferrals = issuedUpdated;
        emit ReferralsIssued(_to, _amount);
    }

    function sendReferral(address _to, uint referralId) external {
        require(referralActivation[referralId] == 0, "Referral already sent");
        referralActivation[referralId] = block.timestamp;
        //TODO: can the referral be re-transferable? What are the implications of sending it to myself?
        transferFrom(msg.sender, _to, referralId);
        emit ReferralSent(msg.sender, _to, referralId);
    }

    function exchangeWithReferral(
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        uint referralId
    ) external {
        uint amountReceived = synthetix().exchange(sourceCurrencyKey, sourceAmount, destinationCurrencyKey);

        uint userSince = existingUsers[msg.sender];

        if (userSince == 0) {
            userSince = block.timestamp;
            existingUsers[msg.sender] = block.timestamp;
        } else {
            userSince = existingUsers[msg.sender];
        }

        if (referralId > 0) {
            uint referralActivationTime = referralActivation[referralId];
            uint timeSinceReferral = block.timestamp.sub(referralActivationTime);
            require(ownerOf(referralId) == msg.sender && timeSinceReferral < REFERRAL_EXPIRATION, "referral inactive");
            // this is where you use an oracle to convert everything back to sUSD, assuming only usd trades for now
            uint newVolume;
            if (sourceCurrencyKey == sUSD) {
                newVolume = volume[msg.sender].add(sourceAmount);
            } else {
                newVolume = volume[msg.sender].add(amountReceived);
            }
            uint timeSinceFirstTrade = block.timestamp.sub(userSince);
            if (newVolume >= TIER1_VOLUME && timeSinceFirstTrade < TRADING_WINDOW) {
                // TODO: this is a hack, we should deactivate the referral instead
                if (whenClaim[msg.sender] == 0) {
                    whenClaim[msg.sender] = nextSnapshot.add(LOCKDOWN_WINDOW);
                }
            }
            volume[msg.sender] = newVolume;
        }
    }

    function claimReferralRewards() external {
        require(whenClaim[msg.sender] > block.timestamp, "cannot claim yet");
        synthetixERC20().transfer(msg.sender, TIER1_REWARDS);
    }

    function takeSnapshot() external {
        require(block.timestamp >= nextSnapshot, "Cannot take snapshot yet");
        nextSnapshot = nextSnapshot.add(SNAPSHOT_FREQUENCY);
    }

    event ReferralsIssued(address _to, uint _amount);
    event ReferralSent(address _from, address _to, uint _referralId);
}
