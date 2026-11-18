import { endpoint } from '../lib/endpoint.js';
import { faucet } from '../lib/api.js';

export default endpoint((db, uid, input) => faucet(db, uid, input));
