declare module 'papaparse' {
  export type ParseResult<T> = {
    data: T[];
    errors: Array<{ message: string }> | null;
  };

  const Papa: {
    parse<T = unknown>(input: string, options: {
      header?: boolean;
      skipEmptyLines?: boolean;
      trimHeaders?: boolean;
    }): ParseResult<T>;
  };

  export default Papa;
}

