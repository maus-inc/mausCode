DROP INDEX `queue_items_sub_chat_id_idx`;--> statement-breakpoint
CREATE INDEX `queue_items_sub_chat_position_idx` ON `queue_items` (`sub_chat_id`,`position`,`created_at`);