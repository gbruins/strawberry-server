import winston from 'winston';
import isObject from 'lodash.isobject';

export const loggerPlugin = {
    name: 'loggerPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const prettyJson = winston.format.printf((info) => {
            info.metaData = isObject(info.meta) ? `- ${JSON.stringify({...info.meta})}` : info.meta;
            return `${info.timestamp} [${info.level}]: ${info.message} ${info.metaData}`;
        });

        global.logger = winston.createLogger({
            format: winston.format.combine(
                winston.format.errors({ stack: true }),
                winston.format.colorize(),
                winston.format.timestamp(),
                // This doesn't acutally format the results in LogDNA, except that it does cause
                // the 'meta' object to be stringified in the LogDNA UI, which is all I really want.
                // A 'prettiefied' meta object in LogDNA is kind of annoying read, I think.
                prettyJson
            ),
            transports: [
                new winston.transports.Console({
                    level: process.env.LOG_LEVEL || 'info'
                })
            ]
        });
    }
};
