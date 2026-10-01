export class MendixEmbeddedError extends Error {
    constructor( code ) {
        super( code );
        this.name = 'MendixEmbeddedError';
        this.code = code;
    }
}

const getMendixConfiguration = ( config ) => {
    if ( !config ) {
        throw new MendixEmbeddedError( 'MISSING_CONFIGURATION' );
    }

    let url;
    try {
        url = new URL( config );
        if ( url.protocol !== 'http:' && url.protocol !== 'https:' ) {
            throw new Error();
        }
    } catch {
        throw new MendixEmbeddedError( 'INVALID_URL' );
    }

    const parameterMappings = Array.from( url.searchParams );

    url.search = '';
    url.hash = '';
    if ( !url.pathname.endsWith( '/' ) ) {
        url.pathname += '/';
    }

    return {
        url: url.toString(),
        parameterMappings
    };
};

export const getResolvedMendixConfiguration = ( config, context ) => {
    const { url, parameterMappings } = getMendixConfiguration( config );
    const parameters = Object.fromEntries(
        parameterMappings.map( ( [ target, value ] ) => [
            target,
            resolveParameterValue( context, value )
        ] )
    );

    if (
        Object.values( parameters ).some(
            ( value ) =>
                value !== undefined &&
                ![ 'string', 'number', 'boolean' ].includes( typeof value )
        )
    ) {
        throw new MendixEmbeddedError( 'INVALID_PARAMETER' );
    }

    return {
        url,
        parameters,
        configurationKey: JSON.stringify( { url, parameters } )
    };
};

export const getMendixContextPaths = ( config ) => {
    const { parameterMappings } = getMendixConfiguration( config );
    return Array.from(
        new Set(
            parameterMappings
                .map( ( [ , value ] ) => getContextPath( value ) )
                .filter( Boolean )
        )
    );
};

const getContextPath = ( value ) =>
    value.startsWith( '{' ) && value.endsWith( '}' ) ? value.slice( 1, -1 ) : null;

const resolveParameterValue = ( context, value ) => {
    const contextPath = getContextPath( value );
    if ( contextPath !== null ) {
        return contextPath
            .split( '.' )
            .reduce( ( resolved, key ) => resolved?.[key], context );
    }

    try {
        const parsedValue = JSON.parse( value );
        if (
            typeof parsedValue === 'string' ||
            typeof parsedValue === 'number' ||
            typeof parsedValue === 'boolean'
        ) {
            return parsedValue;
        }
    } catch {
        // Values that are not valid JSON primitives are plain string literals.
    }

    return value;
};
