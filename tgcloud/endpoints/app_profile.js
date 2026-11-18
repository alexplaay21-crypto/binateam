import { endpoint } from '../lib/endpoint.js';
import { profile } from '../lib/api.js';

export default endpoint((db, uid, input) => profile(db, uid, input));
