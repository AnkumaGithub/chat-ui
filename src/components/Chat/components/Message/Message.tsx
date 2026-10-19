import { AgentActivity } from '@/components/AgentActivity';
import { useAgentRun } from '@/components/AgentActivity/context';
import cn from 'classnames';
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

import { Config } from '@/config';
import { useChat } from '@/helpers/useChat';
import { methodologistService } from '@/stores/services/MethodologistService';
import { EReaction, type IMessage, type TReaction } from '@/types';
import { accessControl$ } from '@n-orm/auth-mf-app';
import {
	EIconName,
	FileItem,
	IFileProps,
	Icon,
	MarkdownViewer,
	Row,
	Text,
	Title,
} from '@sber-orm/ui-kit';

import { Graphs } from '@/components/UniversalChart/components/Graphs';
import { IChartData } from '@/components/UniversalChart/types';
import { ERoles } from '../../types';
import { Table } from '../Table';
import classes from './styles.module.scss';
import type { IMessageProps } from './types';

export const Message = React.memo((props: IMessageProps) => {
	const {
		id,
		isLastMessage,
		loader,
		message = {},
		sending,
		onOpenChart,
	} = props;
	const { reaction, role, skill, text } = message;
	const agentRun = useAgentRun(id as string);
	const isAgentPending = message.extras?.agentPending === 'true';
	const hasAgentTrace = !!agentRun?.events.some(event => event.kind !== 'finish');

	const [hidden, setHidden] = useState(!isLastMessage);
	const [fileIds, setFileIds] = useState<string[]>([]);
	const [files, setFiles] = useState([]);
	const messageRef = useRef<HTMLDivElement | null>(null);

	const { reactOnMessage } = useChat();

	const handleClick = (reaction: TReaction) => {
		reactOnMessage(message as IMessage, reaction);
	};

	const graphsData = useMemo(
		() => message.extras?.chart,
		[message.extras?.chart],
	);

	const isReactionsVisible = useMemo(
		() =>
			role === ERoles.bot &&
			!isAgentPending &&
			(!message.extras?.type || message.extras?.type !== 'system'),
		[isAgentPending, message.extras?.type, role],
	);
	const onMouseOver = useCallback(() => {
		if (isLastMessage) {
			return;
		}
		setHidden(false);
	}, [isLastMessage]);
	const onMouseLeave = useCallback(() => {
		if (isLastMessage) {
			return;
		}
		setHidden(true);
	}, [isLastMessage]);

	const handleOpenChart = () => {
		onOpenChart?.(graphsData);
	};

	const handleLoadFiles = async () => {
		try {
			const result = await methodologistService.getAttachmentList(
				fileIds.join(),
			);

			if (result.success && result.body?.userDocuments?.length) {
				const attachments = result.body?.userDocuments?.reduce(
					(acc, { fields }) => {
						const attach = {
							fileId: fields.fileId!.value,
							fileName: fields.fileName!.value,
							size: fields.size!.value,
							extension: fields.extension!.value,
							progress: 0,
							errors: [],
						};

						return [...acc, attach];
					},
					[],
				);

				setFiles(attachments);
			}
		} catch (error) {
			console.error(error);
		}
	};

	useEffect(() => {
		const ids = message?.extras?.fileIds;

		if (ids) {
			try {
				const fileIds = JSON.parse(ids);
				setFileIds(Array.isArray(fileIds) ? fileIds : []);
			} catch (e) {}
		}
	}, [message]);

	useEffect(() => {
		if (fileIds.length > 0 && !files.length && Config.filesUploadEnabled) {
			(async function () {
				await handleLoadFiles();
			})();
		}
	}, [fileIds]);

	return (
		<Row
			id={id as string}
			className={cn(classes.row, { [classes.rowUser]: role === ERoles.user })}
			direction="column"
			gutter={8}
			onMouseLeave={onMouseLeave}
			onMouseOver={onMouseOver}
		>
			{(hasAgentTrace || isAgentPending) && <AgentActivity run={hasAgentTrace ? agentRun : undefined} />}
			{(loader || text || fileIds.length > 0 || !!graphsData) && <div
				className={cn(classes.message, {
					[classes.messageBot]: role === ERoles.bot || loader,
					[classes.messageLoader]: loader,
					[classes.messageSending]: sending,
					[classes.messageUser]: role === ERoles.user,
					[classes.messageWithFiles]: files.length > 0,
				})}
			>
				<Title
					size="H500"
					thin
					className={classes.messageTitle}
					ref={messageRef}
				>
					{loader ? (
						'...'
					) : (
						<MarkdownViewer
							markdown={text}
							customOptions={{ overrides: { table: { component: Table } } }}
						/>
					)}
				</Title>
				{fileIds.length > 0 &&
					files.length === 0 &&
					Config.filesUploadEnabled && (
						<Row justify="end" gutter={8} wrap>
							{fileIds.map((id) => (
								<div key={id} className={classes.skeleton} />
							))}
						</Row>
					)}
				{files.length > 0 && Config.filesUploadEnabled && (
					<Row className={classes.fileList} justify="end" wrap noFlex>
						{files.map((file) => (
							<FileItem
								className={classes.file}
								key={file.fileId}
								file={file as IFileProps}
								progress={file.progress}
								chat
							>
								{file.fileName}
							</FileItem>
						))}
					</Row>
				)}
				{!!graphsData && accessControl$.userHasAccess('Chat.Graphs') && (
					<Graphs
						onFullScreen={onOpenChart ? handleOpenChart : undefined}
						data={graphsData as IChartData}
					/>
				)}
			</div>}
			{(isReactionsVisible || skill) && (
				<Row
					className={cn(classes.attributes, {
						[classes.attributesAbsolute]: !isLastMessage,
						[classes.hidden]: hidden,
					})}
					justify="start"
					align="middle"
					gutter={4}
				>
					{isReactionsVisible &&
						Object.values(EReaction).map((type) => (
							<button
								key={type}
								type="button"
								className={cn(classes.reaction, {
									[classes.reactionActive]: reaction === type,
								})}
								onClick={() => handleClick(type)}
							>
								<Icon
									name={
										type === EReaction.like
											? EIconName.thumpsUp
											: EIconName.thumpsDown
									}
								/>
							</button>
						))}
					{skill && (
						<Text className={classes.skill} bold>
							{skill}
						</Text>
					)}
				</Row>
			)}
			{sending && (
				<div className={classes.sending}>
					<Icon width={20} height={20} name={EIconName.clock} />
				</div>
			)}
		</Row>
	);
});

Message.displayName = 'Message';
