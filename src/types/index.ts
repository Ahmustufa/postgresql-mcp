export interface TableInfo {
  table_name: string;
  row_estimate: number;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  is_primary_key: boolean;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  row_count: number;
}
