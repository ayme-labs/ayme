import { ayme } from "@ayme-dev/ayme";

@ayme({ description: "A dialog that holds the page until it is closed." })
export class BaseDialog {}

export class ConfirmDialog extends BaseDialog {}

@ayme
class PlainDialog extends BaseDialog {}

export class DeleteDialog extends PlainDialog {}

@ayme({ description: "Deleting the workspace removes it for every member." })
export class DeleteWorkspaceDialog extends DeleteDialog {}

export class DeleteWorkspaceForeverDialog extends DeleteWorkspaceDialog {}

@ayme({ description: "Workspace-wide administration." })
export class AdminPage {}

// The merged interface adds AdminPage as a type-only base, not a runtime one.
/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type */
@ayme
export class PersonalPage {}
export interface PersonalPage extends AdminPage {}
/* eslint-enable @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type */
