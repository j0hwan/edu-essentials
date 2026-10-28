"use client";

import type { ComponentProps } from "react";
import FileUploadDialog from "./file-upload-dialog";
import { NativeDocumentEditor } from "./native-document-editor";
import { FileEditor, FilePreview } from "./private-files";

export type WorkspaceFileDialogEntry<Props> = { key: string; props: Props };

export type WorkspaceFileDialogsProps = {
  nativeDocument?: WorkspaceFileDialogEntry<ComponentProps<typeof NativeDocumentEditor>>;
  fileEditor?: WorkspaceFileDialogEntry<ComponentProps<typeof FileEditor>>;
  filePreview?: WorkspaceFileDialogEntry<ComponentProps<typeof FilePreview>>;
  fileUpload?: WorkspaceFileDialogEntry<ComponentProps<typeof FileUploadDialog>>;
};

export function WorkspaceFileDialogs({ nativeDocument, fileEditor, filePreview, fileUpload }: WorkspaceFileDialogsProps) {
  return <>
    {nativeDocument ? <NativeDocumentEditor key={nativeDocument.key} {...nativeDocument.props} /> : null}
    {fileEditor ? <FileEditor key={fileEditor.key} {...fileEditor.props} /> : null}
    {filePreview ? <FilePreview key={filePreview.key} {...filePreview.props} /> : null}
    {fileUpload ? <FileUploadDialog key={fileUpload.key} {...fileUpload.props} /> : null}
  </>;
}
