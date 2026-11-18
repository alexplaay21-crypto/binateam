import { endpoint } from '../lib/endpoint.js';
import { social } from '../lib/api.js';

export default endpoint((db, uid, input) => social(db, uid, input));
