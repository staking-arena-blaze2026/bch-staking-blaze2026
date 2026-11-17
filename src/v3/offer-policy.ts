import {stakingSecondsToUnits} from './time-policy.js';
import {validateTerms,type Parameters,type Terms} from './model.js';
/** New staking entries have an exact whole-unit effective lock and one reward. */
export function validateNewOffer(p:Parameters,terms:Terms,remaining?:bigint){
 stakingSecondsToUnits(terms.duration);
 if(terms.maxWins!==1)throw Error('New v3 offers must request exactly one reward payment (maxWins = 1)');
 return validateTerms(p,terms,remaining);
}
