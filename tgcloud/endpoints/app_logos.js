import { endpoint } from '../lib/endpoint.js';
import { logos } from '../lib/api.js';

export default endpoint((db, uid, input) => logos(db, input));
