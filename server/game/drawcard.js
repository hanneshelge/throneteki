const _ = require('underscore');

const BaseCard = require('./basecard.js');
const CardMatcher = require('./CardMatcher.js');
const SetupCardAction = require('./setupcardaction.js');
const MarshalCardAction = require('./marshalcardaction.js');
const AmbushCardAction = require('./ambushcardaction.js');

const StandardPlayActions = [
    new SetupCardAction(),
    new MarshalCardAction(),
    new AmbushCardAction()
];

const Icons = ['military', 'intrigue', 'power'];

class DrawCard extends BaseCard {
    constructor(owner, cardData) {
        super(owner, cardData);

        this.dupes = _([]);
        this.attachments = _([]);
        this.icons = {
            military: 0,
            intrigue: 0,
            power: 0
        };

        if(cardData.is_military) {
            this.icons.military++;
        }

        if(cardData.is_intrigue) {
            this.icons.intrigue++;
        }

        if(cardData.is_power) {
            this.icons.power++;
        }

        this.power = 0;
        this.burnValue = 0;
        this.strengthModifier = 0;
        this.strengthMultiplier = 1;
        this.strengthSet = undefined;
        this.dominanceStrengthModifier = 0;
        this.contributesToDominance = true;
        this.kneeled = false;
        this.inChallenge = false;
        this.inDanger = false;
        this.wasAmbush = false;
        this.saved = false;
        this.challengeOptions = {
            doesNotContributeStrength: false,
            doesNotKneelAs: {
                attacker: false,
                defender: false
            },
            mustBeDeclaredAsDefender: false
        };
        this.stealthLimit = 1;
        this.minCost = 0;
        this.eventPlacementLocation = 'discard pile';

        // If setupCardAbilities did not set an attachment restriction, default
        // to allowing attaching on any character.
        if(this.getType() === 'attachment' && !this.attachmentRestrictions) {
            this.attachmentRestriction({ type: 'character' });
        }
    }

    createSnapshot() {
        let clone = new DrawCard(this.owner, this.cardData);

        clone.attachments = _(this.attachments.map(attachment => attachment.createSnapshot()));
        clone.blankCount = this.blankCount;
        clone.controller = this.controller;
        clone.dupes = _(this.dupes.map(dupe => dupe.createSnapshot()));
        clone.factions = Object.assign({}, this.factions);
        clone.icons = Object.assign({}, this.icons);
        clone.keywords = Object.assign({}, this.keywords);
        clone.kneeled = this.kneeled;
        clone.parent = this.parent;
        clone.power = this.power;
        clone.strengthModifier = this.strengthModifier;
        clone.strengthMultiplier = this.strengthMultiplier;
        clone.strengthSet = this.strengthSet;
        clone.tokens = Object.assign({}, this.tokens);
        clone.traits = Object.assign({}, this.traits);
        return clone;
    }

    canBeDuplicated() {
        return this.controller === this.owner;
    }

    addDuplicate(card) {
        if(!this.canBeDuplicated()) {
            return;
        }

        this.dupes.push(card);
        card.moveTo('duplicate', this);
    }

    removeDuplicate(force = false) {
        var firstDupe = undefined;

        if(!force) {
            firstDupe = _.first(this.dupes.filter(dupe => {
                return dupe.owner === this.controller;
            }));
        } else {
            firstDupe = this.dupes.first();
        }

        this.dupes = _(this.dupes.reject(dupe => {
            return dupe === firstDupe;
        }));

        return firstDupe;
    }

    isLimited() {
        return this.hasKeyword('limited') || (!this.isBlank() && this.hasPrintedKeyword('limited'));
    }

    isStealth() {
        return this.hasKeyword('Stealth');
    }

    isTerminal() {
        return this.hasKeyword('Terminal');
    }

    isAmbush() {
        return !_.isUndefined(this.ambushCost);
    }

    isBestow() {
        return !this.isBlank() && !_.isUndefined(this.bestowMax);
    }

    isRenown() {
        return this.hasKeyword('renown');
    }

    hasIcon(icon) {
        return this.icons[icon.toLowerCase()] > 0;
    }

    getPrintedCost() {
        return this.cardData.cost || 0;
    }

    getCost() {
        return this.getPrintedCost();
    }

    getMinCost() {
        return this.minCost;
    }

    getAmbushCost() {
        return this.ambushCost;
    }

    getPower() {
        return this.power;
    }

    modifyStrength(amount, applying = true) {
        if(this.isBurning && this.burnValue === 0 && this.getBoostedStrength(amount) <= 0) {
            this.burnValue = amount;
            this.game.killCharacter(this, { allowSave: false, isBurn: true });
            this.game.queueSimpleStep(() => {
                this.strengthModifier += amount;
                this.burnValue = 0;
            });
            return;
        }

        this.strengthModifier += amount;
        this.game.raiseEvent('onCardStrengthChanged', {
            card: this,
            amount: amount,
            applying: applying
        });
    }

    modifyStrengthMultiplier(amount, applying = true) {
        let strengthBefore = this.getStrength();

        this.strengthMultiplier *= amount;
        this.game.raiseEvent('onCardStrengthChanged', {
            card: this,
            amount: this.getStrength() - strengthBefore,
            applying: applying
        });
    }

    getPrintedStrength() {
        return (this.cardData.strength || 0);
    }

    getStrength() {
        return this.getBoostedStrength(0);
    }

    getBoostedStrength(boostValue) {
        let baseStrength = this.getPrintedStrength();

        if(this.controller.phase === 'setup') {
            return baseStrength;
        }

        if(_.isNumber(this.strengthSet)) {
            return this.strengthSet;
        }

        let modifiedStrength = this.strengthModifier + baseStrength + boostValue;
        let multipliedStrength = Math.round(this.strengthMultiplier * modifiedStrength);
        return Math.max(0, multipliedStrength);
    }

    modifyDominanceStrength(amount) {
        this.dominanceStrengthModifier += amount;
    }

    getDominanceStrength() {
        let baseStrength = !this.kneeled && this.getType() === 'character' && this.contributesToDominance ? this.getStrength() : 0;

        return Math.max(0, baseStrength + this.dominanceStrengthModifier);
    }

    getIcons() {
        return _.filter(Icons, icon => this.hasIcon(icon));
    }

    getIconsAdded() {
        var icons = [];

        if(this.hasIcon('military') && !this.cardData.is_military) {
            icons.push('military');
        }

        if(this.hasIcon('intrigue') && !this.cardData.is_intrigue) {
            icons.push('intrigue');
        }

        if(this.hasIcon('power') && !this.cardData.is_power) {
            icons.push('power');
        }

        return icons;
    }

    getIconsRemoved() {
        var icons = [];

        if(!this.hasIcon('military') && this.cardData.is_military) {
            icons.push('military');
        }

        if(!this.hasIcon('intrigue') && this.cardData.is_intrigue) {
            icons.push('intrigue');
        }

        if(!this.hasIcon('power') && this.cardData.is_power) {
            icons.push('power');
        }

        return icons;
    }

    getNumberOfIcons() {
        let count = 0;

        if(this.hasIcon('military')) {
            count += 1;
        }
        if(this.hasIcon('intrigue')) {
            count += 1;
        }
        if(this.hasIcon('power')) {
            count += 1;
        }

        return count;
    }

    addIcon(icon) {
        this.icons[icon.toLowerCase()]++;
    }

    removeIcon(icon) {
        this.icons[icon.toLowerCase()]--;
    }

    modifyPower(power) {
        this.game.applyGameAction('gainPower', this, card => {
            let oldPower = card.power;

            card.power += power;

            if(card.power < 0) {
                card.power = 0;
            }

            if(power > 0) {
                this.game.raiseEvent('onCardPowerGained', { card: this, power: card.power - oldPower });
            }

            this.game.checkWinCondition(this.controller);
        });
    }

    needsStealthTarget() {
        return this.isStealth() && !this.stealthTarget;
    }

    canUseStealthToBypass(targetCard) {
        return this.isStealth() && targetCard.canBeBypassedByStealth();
    }

    useStealthToBypass(targetCard) {
        if(!this.canUseStealthToBypass(targetCard)) {
            return false;
        }

        targetCard.stealth = true;
        this.stealthTarget = targetCard;

        return true;
    }

    /**
     * Defines restrictions on what cards this attachment can be placed on.
     */
    attachmentRestriction(...restrictions) {
        this.attachmentRestrictions = restrictions.map(restriction => {
            if(_.isFunction(restriction)) {
                return restriction;
            }

            return CardMatcher.createAttachmentMatcher(restriction);
        });
    }

    /**
     * Checks 'no attachment' restrictions for this card when attempting to
     * attach the passed attachment card.
     */
    allowAttachment(attachment) {
        return (
            this.isBlank() ||
            this.allowedAttachmentTrait === 'any' ||
            this.allowedAttachmentTrait !== 'none' && attachment.hasTrait(this.allowedAttachmentTrait)
        );
    }

    /**
     * Checks whether the passed card meets the attachment restrictions (e.g.
     * Opponent cards only, specific factions, etc) for this card.
     */
    canAttach(player, card) {
        if(this.getType() !== 'attachment' || !card) {
            return false;
        }

        let context = { player: player };

        return this.attachmentRestrictions.some(restriction => restriction(card, context));
    }

    removeChildCard(card) {
        if(!card) {
            return;
        }

        this.attachments = _(this.attachments.reject(a => a === card));
        this.dupes = _(this.dupes.reject(a => a === card));
    }

    getPlayActions() {
        return StandardPlayActions
            .concat(this.abilities.playActions)
            .concat(_.filter(this.abilities.actions, action => !action.allowMenu()));
    }

    leavesPlay() {
        this.kneeled = false;
        this.power = 0;
        this.wasAmbush = false;
        this.new = false;
        this.clearDanger();
        this.resetForChallenge();

        super.leavesPlay();
    }

    resetForChallenge() {
        this.stealth = false;
        this.stealthTarget = undefined;
        this.inChallenge = false;
    }

    canDeclareAsAttacker(challengeType) {
        return this.allowGameAction('declareAsAttacker') && this.canDeclareAsParticipant(challengeType);
    }

    canDeclareAsDefender(challengeType) {
        return this.allowGameAction('declareAsDefender') && this.canDeclareAsParticipant(challengeType);
    }

    canDeclareAsParticipant(challengeType) {
        return (
            this.canParticipateInChallenge() &&
            this.location === 'play area' &&
            !this.stealth &&
            (!this.kneeled || this.challengeOptions.canBeDeclaredWhileKneeling) &&
            (this.hasIcon(challengeType) || this.challengeOptions.canBeDeclaredWithoutIcon)
        );
    }

    canParticipateInChallenge() {
        return this.getType() === 'character'
            && this.allowGameAction('participateInChallenge');
    }

    canBeBypassedByStealth() {
        return !this.isStealth() && this.allowGameAction('bypassByStealth');
    }

    canBeKilled() {
        return this.allowGameAction('kill');
    }

    canBeSaved() {
        return this.allowGameAction('save');
    }

    markAsInDanger() {
        this.inDanger = true;
    }

    markAsSaved() {
        this.inDanger = false;
        this.saved = true;
    }

    clearDanger() {
        this.inDanger = false;
        this.saved = false;
    }

    getSummary(activePlayer, hideWhenFaceup) {
        let baseSummary = super.getSummary(activePlayer, hideWhenFaceup);

        return _.extend(baseSummary, {
            attached: !!this.parent,
            attachments: this.attachments.map(attachment => {
                return attachment.getSummary(activePlayer, hideWhenFaceup);
            }),
            baseStrength: this.getPrintedStrength(),
            dupes: this.dupes.map(dupe => {
                if(dupe.dupes.size() !== 0) {
                    throw new Error('A dupe should not have dupes! ' + dupe.name);
                }

                return dupe.getSummary(activePlayer, hideWhenFaceup);
            }),
            iconsAdded: this.getIconsAdded(),
            iconsRemoved: this.getIconsRemoved(),
            inChallenge: this.inChallenge,
            inDanger: this.inDanger,
            kneeled: this.kneeled,
            power: this.power,
            saved: this.saved,
            strength: this.getStrength(),
            stealth: this.stealth
        });
    }
}

module.exports = DrawCard;
