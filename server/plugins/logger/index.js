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
                winston.format.timestamp(),
                prettyJson
            ),
            transports: [
                new winston.transports.Console({
                    level: process.env.LOG_LEVEL || 'info',
                    // A transport-level `format` replaces the logger-level one above entirely
                    // for that transport, so this repeats errors/timestamp too, not just adding
                    // colorize to what's already there. Colorized only here — ANSI escape codes
                    // in the file transport below would just show up as literal `\x1b[...]`
                    // noise when read back.
                    format: winston.format.combine(
                        winston.format.errors({ stack: true }),
                        winston.format.timestamp(),
                        winston.format.colorize(),
                        prettyJson
                    )
                }),
                // Plain-file copy of the same log, gitignored (see .gitignore's `/logs`), so
                // anything reading the file instead of this process's own console (e.g. a tool
                // without access to a terminal the server happens to be running in) can still
                // see what the server logged.
                new winston.transports.File({
                    level: process.env.LOG_LEVEL || 'info',
                    filename: 'logs/server.log'
                })
            ]
        });
    }
};
