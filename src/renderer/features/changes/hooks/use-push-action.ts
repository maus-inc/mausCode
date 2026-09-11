import { useCallback } from "react";
import { toast } from "sonner";
import { trpc } from "../../../lib/trpc";

interface UsePushActionOptions {
	worktreePath?: string | null;
	hasUpstream?: boolean;
	onSuccess?: () => void;
}

export function usePushAction({
	worktreePath,
	hasUpstream = true,
	onSuccess,
}: UsePushActionOptions) {
	const pushMutation = trpc.changes.push.useMutation({
		onSuccess: () => {
			onSuccess?.();
		},
		onError: (error) => toast.error(`Push failed: ${error.message}`),
	});

	const push = useCallback(async (): Promise<boolean> => {
		if (!worktreePath) {
			toast.error("Worktree path is required");
			return false;
		}
		try {
			await pushMutation.mutateAsync({ worktreePath, setUpstream: !hasUpstream });
			return true;
		} catch {
			// onError toast already fired; surface failure to the caller
			return false;
		}
	}, [worktreePath, hasUpstream, pushMutation]);

	return { push, isPending: pushMutation.isPending };
}
