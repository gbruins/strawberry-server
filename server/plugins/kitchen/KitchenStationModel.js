import Joi from 'joi';
import BaseModel from '../base/BaseModel.js';

export const tableName = 'kitchen_stations';

export default class KitchenStationModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tableName;
        // pin_hash/session_token_hash must never round-trip through a generic response —
        // the owner-facing CRUD (create/rotate/revoke) only ever returns the plaintext PIN
        // once, at creation time, via a response shape built outside of getAllColumns().
        this.hidden = ['deleted_at', 'pin_hash', 'session_token_hash'];
        this.schema = {
            id: Joi.string().uuid().allow(null),
            tenant_id: Joi.string().uuid(),
            name: Joi.string().trim().max(100).required(),
            station_code: Joi.string().trim().max(12),
            session_expires_at: Joi.date().allow(null),
            revoked_at: Joi.date().allow(null),
            created_at: Joi.date()
        };
    }

}
