import { endpoint } from '../lib/endpoint.js';
import { shop } from '../lib/api.js';

export default endpoint((db, uid, input) => shop(db, uid, input));
