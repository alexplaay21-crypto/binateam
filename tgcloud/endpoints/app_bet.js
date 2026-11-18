import { endpoint } from '../lib/endpoint.js';
import { bet } from '../lib/api.js';

export default endpoint((db, uid, input) => bet(db, uid, input));
