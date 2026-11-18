import { endpoint } from '../lib/endpoint.js';
import { market } from '../lib/api.js';

export default endpoint((db, uid, input) => market(db, input));
