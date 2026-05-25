export type PendingInventoryOperationArea = 'development' | 'scan-paths';
export type PendingInventoryOperationKind =
  | 'add-scan-path'
  | 'clear-canonical-path'
  | 'refresh-inventory'
  | 'remove-scan-path'
  | 'reset-sandbox'
  | 'set-canonical-path'
  | 'switch-inventory-source';

export interface PendingInventoryOperation {
  area: PendingInventoryOperationArea;
  detail: string;
  kind: PendingInventoryOperationKind;
  title: string;
}
