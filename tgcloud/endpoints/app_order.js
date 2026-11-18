import { endpoint } from '../lib/endpoint.js';
import { order } from '../lib/api.js';

export default endpoint((db, uid, input) => order(db, uid, input));
