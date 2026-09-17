CREATE TABLE `run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_events_run_id_seq_uq` ON `run_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`sub_chat_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`stop_reason` text,
	`approval_pending` integer DEFAULT false NOT NULL,
	`engine` text,
	`provider` text,
	`model` text,
	`last_seq` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`sub_chat_id`) REFERENCES `sub_chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_sub_chat_id_idx` ON `runs` (`sub_chat_id`);--> statement-breakpoint
CREATE INDEX `runs_status_idx` ON `runs` (`status`);