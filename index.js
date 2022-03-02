const core = require('@actions/core')

const {Octokit} = require("@octokit/rest")
const {retry} = require("@octokit/plugin-retry");
const {throttling} = require("@octokit/plugin-throttling");
const _Octokit = Octokit.plugin(retry, throttling)

const body = core.getInput('BODY', {required: true, trimWhitespace: true}).split(' ')
const org = core.getInput('ORG', {required: true, trimWhitespace: true})
const repo = core.getInput('REPO', {required: true, trimWhitespace: true})
const issueNumber = core.getInput('ISSUE_NUMBER', {required: true, trimWhitespace: true})
const teamID = Number(core.getInput('TEAM_ID', {required: true, trimWhitespace: true}))
const token = core.getInput('TOKEN', {required: true, trimWhitespace: true})

const client = new _Octokit({
    auth: token,
    throttle: {
        onRateLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(`Request quota exhausted for request ${options.method} ${options.url}`);
            if (options.request.retryCount <= 1) {
                octokit.log.info(`Retrying after ${retryAfter} seconds!`);
                return true;
            }
        },
        onAbuseLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(`Abuse detected for request ${options.method} ${options.url}`);
        },
    }

});

(async function () {
    const username = body[body.length - 1]
    try {
        core.info(`Checking if user ${username} is a member of ${org}`)
        const response = await client.orgs.checkMembershipForUser({
            org: org,
            username: username
        })
        switch (response.status) {
            case 204:
                core.info(`User ${username} is already member of ${org}`)
                await sendComment(`${username} is already member of the ${org} organization`)
                break
            case 302:
                core.setFailed(`Requestor not authorized to perform this action`)
                await sendComment(`You are not authorized to make this request`)
                process.exit(1)
                break
            default:
                core.setFailed(`Unknown response from GitHub API: ${response.status}`)
                await sendComment(`Unable to determine membership for ${username}`)
                process.exit(1)
        }
    } catch (err) {
        if (err.status === 404) {
            core.info(`User ${username} is not a member of ${org}`)
            core.info(`Inviting user ${username} to ${org}`)
            try {
                const {data: user} = await client.users.getByUsername({
                    username: username
                })
                await client.orgs.createInvitation({
                    org: org,
                    role: 'direct_member',
                    invitee_id: user.id,
                    team_ids: [teamID]
                })
            } catch (err) {
                core.setFailed(err.message)
                await sendComment(`Failed to invite ${username} to ${org}: ${err.message}`)
                process.exit(1)
            }
            await sendComment(`${username} is not a member of the ${org} organization`)
            process.exit(1)
        }
        await sendComment(`An error occurred while checking membership: ${err.message}`)
        core.setFailed(err.message)
        process.exit(1)
    }
})()

async function sendComment(comment) {
    try {
        core.info(`Sending response: ${comment}`)
        await client.issues.createComment({
            owner: org,
            repo: repo,
            issue_number: issueNumber,
            body: comment
        })
    } catch (err) {
        core.setFailed(err.message)
    }
}
