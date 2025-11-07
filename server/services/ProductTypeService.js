import ProductTypeModel from '../models/ProductTypeModel.js';
import BaseService from './BaseService.js';

export default class ProductTypeService extends BaseService {

    constructor() {
        super(new ProductTypeModel());
    }


    async addProductType(data) {
        // const allTypes = await super.search({
        //     where: { object: data.object }
        // });

        const allTypes = await super.search();

        data.value = this.getNextAvailableTypeValue(allTypes);

        return super.upsertOne({
            data: data
        });
    }


    getNextAvailableTypeValue(allTypes) {
        let highestValue = 0;

        // find the highest value
        allTypes.forEach((obj) => {
            if(obj.value > highestValue) {
                highestValue = obj.value;
            }
        });

        let factor = 0;

        if(highestValue) {
            factor = parseInt(Math.log(highestValue) / Math.log(2), 10); // current factor
            factor++; // what the new factor should be
        }

        return Math.pow(2, factor);
    }



    formatForUpsert(data) {
        if (data.metadata) {
            data.metadata = JSON.stringify(data.metadata)
        }

        return data;
    }


    getValidationSchemaForAdd() {
        const schema = { ...super.getValidationSchemaForAdd() };
        schema.name = schema.name.required();

        return schema;
    }

}
