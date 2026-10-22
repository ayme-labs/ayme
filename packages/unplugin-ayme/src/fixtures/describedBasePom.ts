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
