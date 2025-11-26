import knex from 'knex';
import { attachPaginate } from 'knex-paginate';
import knexConfig from '../knexfile.js';

const db = knex(knexConfig);
attachPaginate(); // Attach pagination plugin

export default db;
