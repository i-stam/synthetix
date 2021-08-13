pragma solidity ^0.5.16;

// Inheritance
import "./MixinResolver.sol";
import "./Owned.sol";

// Internal references
import "./interfaces/ISynthetix.sol";

// External dependencies.
import "openzeppelin-solidity-2.3.0/contracts/token/ERC721/ERC721.sol";

contract ReferralProxy is MixinResolver, Owned, ERC721 {
    uint256 public constant REFERRAL_EXPIRATION = 30 days;

    bytes32 private constant sUSD = "sUSD";
    bytes32 private constant CONTRACT_SYNTHETIX = "Synthetix";

    uint public issuedReferrals = 1; //hack so we dont assign id 0 which is used as "no referral"

    mapping(address => uint) public existingUsers;
    mapping(uint => address) public referralOrigin;
    mapping(address => uint) public volume;

    // ========== CONSTRUCTOR ==========

    constructor(address owner, address _resolver) public Owned(owner) MixinResolver(_resolver) {}

    function synthetix() internal view returns (ISynthetix) {
        return ISynthetix(requireAndGetAddress(CONTRACT_SYNTHETIX));
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
        require(existingUsers[_to] == 0, "User exists");
        existingUsers[_to] = block.timestamp;
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
        if (userSince > 0) {
            if (referralId > 0) {
                uint timeSinceReferral = block.timestamp.sub(userSince);
                require(ownerOf(referralId) == msg.sender && timeSinceReferral < REFERRAL_EXPIRATION, "referral inactive");
                // this is where you use an oracle to convert everything back to sUSD, assuming only usd trades for now
                if (sourceCurrencyKey == sUSD) {
                    volume[msg.sender] = volume[msg.sender].add(sourceAmount);
                } else {
                    volume[msg.sender] = volume[msg.sender].add(amountReceived);
                }
            }
        } else {
            existingUsers[msg.sender] = block.timestamp;
        }
    }

    event ReferralsIssued(address _to, uint _amount);
    event ReferralSent(address _from, address _to, uint _referralId);
}
