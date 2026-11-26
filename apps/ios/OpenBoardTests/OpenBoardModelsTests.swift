import XCTest
@testable import OpenBoard

final class OpenBoardModelsTests: XCTestCase {
    func testDecodesMeResponse() throws {
        let json = """
        {
          "actor": "act_stan",
          "principal": "pri_stan",
          "kind": "person",
          "handle": "stan",
          "name": "Stan Girard",
          "avatar": "https://avatars.githubusercontent.com/u/19614572?v=4",
          "openboard": {
            "org": { "slug": "tvc", "name": "The Vibe Company" },
            "board": { "slug": "main", "name": "main" },
            "role": "owner",
            "credential": "personal"
          }
        }
        """
        let me = try JSONDecoder().decode(MeResponse.self, from: Data(json.utf8))
        XCTAssertEqual(me.handle, "stan")
        XCTAssertEqual(me.kind, .person)
        XCTAssertEqual(me.openboard?.org.slug, "tvc")
        XCTAssertEqual(me.openboard?.board.slug, "main")
    }

    func testDecodesTaskSummaryAndSortsDoneNewestFirst() throws {
        let json = """
        {
          "tasks": [
            {
              "message": {
                "id": "5",
                "channel": "openboard",
                "text": "Older done task",
                "mentions": [],
                "re": null,
                "replyTo": null,
                "thread": "5",
                "labels": { "board.task": "completed", "area": "release" },
                "reactions": { "rocket": ["act_1"] },
                "by": { "actor": "act_1", "principal": "pri_1", "profile": null },
                "from": "Stan",
                "createdAt": "2026-11-24T10:00:00.000Z",
                "editedAt": null,
                "deleted": false,
                "attachments": [],
                "version": 20,
                "task": {
                  "state": "completed",
                  "owner": "act_1",
                  "by": "act_1",
                  "for": null,
                  "needs": [],
                  "epoch": 1,
                  "claim": null,
                  "blocked": null,
                  "result": "Published 0.4.0",
                  "reason": null
                },
                "revision": 3,
                "author": { "kind": "person", "handle": "stan", "name": "Stan Girard", "avatar": null, "via": null }
              },
              "replies": 2,
              "last": null
            },
            {
              "message": {
                "id": "182",
                "channel": "openboard",
                "text": "Newer done task",
                "mentions": [],
                "re": null,
                "replyTo": null,
                "thread": "182",
                "labels": { "board.task": "completed" },
                "reactions": {},
                "by": { "actor": "act_1", "principal": "pri_1", "profile": null },
                "from": "Stan",
                "createdAt": "2026-11-25T22:00:00.000Z",
                "editedAt": null,
                "deleted": false,
                "attachments": [],
                "version": 99,
                "task": {
                  "state": "completed",
                  "owner": "act_1",
                  "by": "act_1",
                  "for": null,
                  "needs": ["5"],
                  "epoch": 1,
                  "claim": null,
                  "blocked": null,
                  "result": "Shipped",
                  "reason": null
                },
                "revision": 2,
                "author": { "kind": "person", "handle": "stan", "name": "Stan Girard", "avatar": null, "via": null }
              },
              "replies": 0,
              "last": null
            }
          ],
          "cursor": "99"
        }
        """
        let page = try JSONDecoder().decode(TasksResponse.self, from: Data(json.utf8))
        XCTAssertEqual(page.tasks.count, 2)
        XCTAssertEqual(page.tasks[0].message.visibleLabels.count, 1)
        XCTAssertEqual(page.tasks[0].message.visibleLabels[0].key, "area")

        let sorted = page.tasks.sorted { BoardStore.doneOrder($0, $1) }
        XCTAssertEqual(sorted.map(\.id), ["182", "5"])
        XCTAssertEqual(BoardStore.mergeTasks(page.tasks, incoming: [sorted[0]]).map(\.id), ["182", "5"])
        XCTAssertEqual(OpenBoardAPI.taskPageLimit(501), 500)
    }

    func testSSEDecoderDispatchesOnBlankLine() {
        let stream = """
        : keepalive\r
        id: 42\r
        event: board\r
        data: {"cursor":"42","type":"channel.created","createdAt":"2026-11-25T22:00:00.000Z","message":null,"payload":{"channel":"mobile","thread":null,"name":null,"handle":null,"error":null,"by":null}}\r
        \r\n
        """
        var decoder = SSEStreamDecoder()
        var decoded: [(id: String?, event: BoardEvent?)] = []
        for byte in stream.utf8 {
            if let frame = decoder.consume(byte: byte) {
                decoded.append(frame)
            }
        }
        XCTAssertEqual(decoded.count, 1)
        XCTAssertEqual(decoded.first?.id, "42")
        XCTAssertEqual(decoded.first?.event?.type, "channel.created")
        XCTAssertEqual(decoded.first?.event?.channelPath, "mobile")
        XCTAssertEqual(decoded.first?.event?.summaryText, "Created channel #mobile")
    }

    func testSSECheckpointAndTerminalResponses() {
        var decoder = SSEStreamDecoder()
        XCTAssertNil(decoder.consume(line: "id: 42"))
        let checkpoint = decoder.consume(line: "")
        XCTAssertEqual(checkpoint?.id, "42")
        XCTAssertNil(checkpoint?.event)
        XCTAssertNil(decoder.consume(line: ""))
        XCTAssertTrue(BoardEventStream.isTerminal(status: 401))
        XCTAssertTrue(BoardEventStream.isTerminal(status: 403))
        XCTAssertFalse(BoardEventStream.isTerminal(status: 503))
    }

    func testClaimScopeAndExpiry() {
        let scope = ClaimScope(api: OpenBoardAPI(origin: "https://example.test"), actor: "actor", taskID: "1")
        let other = ClaimScope(api: OpenBoardAPI(origin: "https://example.test", board: "other"), actor: "actor", taskID: "1")
        let proof = LocalTaskClaim(epoch: 1, token: "fixture", until: "1970-01-01T00:00:01.000Z")
        let claims = [scope: proof]
        let now = Date(timeIntervalSince1970: 0)
        XCTAssertEqual(scope.activeClaim(in: claims, epoch: 1, now: now), proof)
        XCTAssertNil(other.activeClaim(in: claims, epoch: 1, now: now))
        XCTAssertNil(scope.activeClaim(in: claims, epoch: 2, now: now))
        XCTAssertNil(scope.activeClaim(in: claims, epoch: 1, now: now.addingTimeInterval(1)))
    }

    func testPreviewLineStripsMarkdownAndResolvesMentions() {
        let mentions = [
            MessageMention(
                written: "@act_1",
                actor: .init(id: "act_1", handle: "stan", name: "Stan Girard")
            )
        ]
        let preview = TextFormatting.previewLine("## **Ship** `@act_1` iOS\nSecond line", mentions: mentions, fallback: "Thread")
        XCTAssertEqual(preview, "Ship @stan iOS")
    }

    func testOAuthCallbackParserValidatesStateAndExtractsCode() throws {
        let state = "abc123def4567890"
        let startURL = try XCTUnwrap(OAuthCallbackParser.makeAuthURL(origin: "https://openboard.thevibecompany.co/", clientState: state))
        XCTAssertEqual(startURL.absoluteString, "https://openboard.thevibecompany.co/auth/github/start?app=ios&client_state=\(state)")

        let valid = try XCTUnwrap(URL(string: "openboard://auth/callback?code=secret_code_1&state=\(state)"))
        XCTAssertEqual(OAuthCallbackParser.parse(url: valid, expectedState: state), .code("secret_code_1"))

        let mismatch = try XCTUnwrap(URL(string: "openboard://auth/callback?code=secret_code_1&state=wrong"))
        XCTAssertEqual(OAuthCallbackParser.parse(url: mismatch, expectedState: state), .error("Sign-in state mismatch. Please try again."))

        let noOrg = try XCTUnwrap(URL(string: "openboard://auth/callback?error=no_org&state=\(state)"))
        XCTAssertEqual(OAuthCallbackParser.parse(url: noOrg, expectedState: state), .error("Your GitHub account is not a member of an OpenBoard organization yet."))
    }

    @MainActor
    func testProxyErrorsUseStatusCodeAndParseRetryAfterSeconds() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ProxyResponseProtocol.self]
        let session = URLSession(configuration: configuration)
        let cases: [(status: String, header: String, seconds: Int?)] = [
            ("401", "missing", nil), ("429", "120", 120), ("429", "0", 0),
            ("429", "missing", nil), ("429", "invalid", nil), ("429", "-5", nil),
            ("429", "1.5", nil), ("429", "999999999999999999999", nil),
        ]
        for (status, header, seconds) in cases {
            let api = OpenBoardAPI(origin: "https://openboard.test", org: status, board: header, urlSession: session)
            do {
                _ = try await api.getMe()
                XCTFail("Expected HTTP \(status) to throw")
            } catch OpenBoardAPIError.unauthorized(let message) where status == "401" {
                XCTAssertEqual(message, "")
            } catch OpenBoardAPIError.rateLimited(let retryAfter) where status == "429" {
                XCTAssertEqual(retryAfter, seconds, "Retry-After: \(header)")
            }
        }
    }
}

private final class ProxyResponseProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        // The fixture URL encodes the status and header, independent of other tests.
        let path = request.url?.pathComponents ?? []
        guard let url = request.url, path.count == 5, let status = Int(path[2]),
              let response = HTTPURLResponse(
                  url: url, statusCode: status, httpVersion: "HTTP/1.1",
                  headerFields: path[3] == "missing" ? [:] : ["Retry-After": path[3]]
              )
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("<html>Proxy error</html>".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
