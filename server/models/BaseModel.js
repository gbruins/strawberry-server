
import tables from '../db/utils/tables.js';


export default class BaseModel {

    constructor() {
        this.tableName = null;
        this.schema = {};
        this.hidden = ['deleted_at'];
        // this.tables = tables;
    }


    getSchema() {
        return this.schema;
    }


    isSoftDelete() {
        return this.schema.hasOwnProperty('deleted_at');
    }


    getAllColumns(includeHiddenCols) {
        let keys = Object.keys(this.schema);

        if(!includeHiddenCols) {
            keys = keys.filter(key => !this.hidden.includes(key))
        }

        // using a Set will de-dupe the column names
        const colNameSet = new Set(keys);
        return Array.from(colNameSet);
    }

}
