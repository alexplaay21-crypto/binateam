import { endpoint } from '../lib/endpoint.js';
import { tokens } from '../lib/api.js';

export default endpoint((db, uid, input) => tokens(db, input));
