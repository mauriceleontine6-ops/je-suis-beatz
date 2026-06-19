import { ConnectorConfig, DataConnect, OperationOptions, ExecuteOperationResponse } from 'firebase-admin/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;


export interface Beat_Key {
  id: UUIDString;
  __typename?: 'Beat_Key';
}

export interface CreateBeatData {
  beat_insert: Beat_Key;
}

export interface CreateBeatVariables {
  title: string;
  genre: string;
  previewUrl: string;
  bpm?: number | null;
  key?: string | null;
  description?: string | null;
}

export interface FileAsset_Key {
  id: UUIDString;
  __typename?: 'FileAsset_Key';
}

export interface GetLicenseDetailsData {
  licenseTypes: ({
    id: UUIDString;
    name: string;
    price: number;
  } & LicenseType_Key)[];
}

export interface GetLicenseDetailsVariables {
  beatId: UUIDString;
}

export interface LicenseType_Key {
  id: UUIDString;
  __typename?: 'LicenseType_Key';
}

export interface ListMyBeatsData {
  beats: ({
    id: UUIDString;
    title: string;
    genre: string;
    bpm?: number | null;
  } & Beat_Key)[];
}

export interface PurchaseBeatData {
  purchase_insert: Purchase_Key;
}

export interface PurchaseBeatVariables {
  licenseTypeId: UUIDString;
  downloadUrl: string;
}

export interface Purchase_Key {
  id: UUIDString;
  __typename?: 'Purchase_Key';
}

export interface User_Key {
  id: UUIDString;
  __typename?: 'User_Key';
}

/** Generated Node Admin SDK operation action function for the 'CreateBeat' Mutation. Allow users to execute without passing in DataConnect. */
export function createBeat(dc: DataConnect, vars: CreateBeatVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateBeatData>>;
/** Generated Node Admin SDK operation action function for the 'CreateBeat' Mutation. Allow users to pass in custom DataConnect instances. */
export function createBeat(vars: CreateBeatVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateBeatData>>;

/** Generated Node Admin SDK operation action function for the 'PurchaseBeat' Mutation. Allow users to execute without passing in DataConnect. */
export function purchaseBeat(dc: DataConnect, vars: PurchaseBeatVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<PurchaseBeatData>>;
/** Generated Node Admin SDK operation action function for the 'PurchaseBeat' Mutation. Allow users to pass in custom DataConnect instances. */
export function purchaseBeat(vars: PurchaseBeatVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<PurchaseBeatData>>;

/** Generated Node Admin SDK operation action function for the 'ListMyBeats' Query. Allow users to execute without passing in DataConnect. */
export function listMyBeats(dc: DataConnect, options?: OperationOptions): Promise<ExecuteOperationResponse<ListMyBeatsData>>;
/** Generated Node Admin SDK operation action function for the 'ListMyBeats' Query. Allow users to pass in custom DataConnect instances. */
export function listMyBeats(options?: OperationOptions): Promise<ExecuteOperationResponse<ListMyBeatsData>>;

/** Generated Node Admin SDK operation action function for the 'GetLicenseDetails' Query. Allow users to execute without passing in DataConnect. */
export function getLicenseDetails(dc: DataConnect, vars: GetLicenseDetailsVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetLicenseDetailsData>>;
/** Generated Node Admin SDK operation action function for the 'GetLicenseDetails' Query. Allow users to pass in custom DataConnect instances. */
export function getLicenseDetails(vars: GetLicenseDetailsVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetLicenseDetailsData>>;

