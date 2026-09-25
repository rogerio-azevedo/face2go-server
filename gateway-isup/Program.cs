using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using static QuickNV.HikvisionISUPSDK.Defines;
using static QuickNV.HikvisionISUPSDK.Methods;

var token = Environment.GetEnvironmentVariable("HIK_GATEWAY_TOKEN") ?? "";
var isupKey = Environment.GetEnvironmentVariable("ISUP_KEY") ?? "";
var publicHost = Environment.GetEnvironmentVariable("ISUP_PUBLIC_HOST") ?? "184.194.233.81";
var listenPort = int.TryParse(Environment.GetEnvironmentVariable("ISUP_LISTEN_PORT"), out var lp) ? lp : 7660;
var controlPort = int.TryParse(Environment.GetEnvironmentVariable("CONTROL_PORT"), out var cp) ? cp : 8091;
var mediaPort = int.TryParse(Environment.GetEnvironmentVariable("MEDIA_PORT"), out var mp) ? mp : 8092;
var mediaPublicBase = (Environment.GetEnvironmentVariable("MEDIA_PUBLIC_BASE") ?? $"http://{publicHost}:{mediaPort}").TrimEnd('/');
var certPath = Environment.GetEnvironmentVariable("GATEWAY_TLS_CERT") ?? "";
var keyPath = Environment.GetEnvironmentVariable("GATEWAY_TLS_KEY") ?? "";

if (token.Length < 16)
{
    Console.Error.WriteLine("HIK_GATEWAY_TOKEN ausente ou curto demais");
    Environment.Exit(1);
}
if (string.IsNullOrWhiteSpace(isupKey))
{
    Console.Error.WriteLine("ISUP_KEY ausente");
    Environment.Exit(1);
}
if (!File.Exists(certPath) || !File.Exists(keyPath))
{
    Console.Error.WriteLine("GATEWAY_TLS_CERT/GATEWAY_TLS_KEY ausentes");
    Environment.Exit(1);
}

LinkNativeAliases(AppContext.BaseDirectory);
PreloadNative(AppContext.BaseDirectory);

var cms = new CmsListener(isupKey.Trim(), publicHost, listenPort);
cms.Start();
var media = new MediaStore(TimeSpan.FromSeconds(120));

var cert = X509Certificate2.CreateFromPemFile(certPath, keyPath);
cert = new X509Certificate2(cert.Export(X509ContentType.Pfx));

Environment.SetEnvironmentVariable("ASPNETCORE_URLS", "");
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options =>
{
    options.Listen(IPAddress.Any, controlPort, listen => listen.UseHttps(cert));
    options.Listen(IPAddress.Any, mediaPort);
});
var app = builder.Build();

app.Use(async (ctx, next) =>
{
    if (ctx.Connection.LocalPort == mediaPort)
    {
        if (HttpMethods.IsGet(ctx.Request.Method) && ctx.Request.Path.StartsWithSegments("/f"))
        {
            await next();
            return;
        }
        ctx.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }
    if (!BearerOk(ctx.Request.Headers.Authorization.ToString(), token))
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await ctx.Response.WriteAsJsonAsync(new { error = "unauthorized" });
        return;
    }
    await next();
});

app.MapGet("/devices", () => Results.Json(cms.List()));

app.MapPost("/devices/{ehomeId}/isapi", async (string ehomeId, HttpRequest request) =>
{
    IsapiCommand? cmd;
    try
    {
        cmd = await request.ReadFromJsonAsync<IsapiCommand>();
    }
    catch (JsonException)
    {
        return Results.Json(new { error = "json invalido" }, statusCode: StatusCodes.Status400BadRequest);
    }
    if (cmd == null || string.IsNullOrWhiteSpace(cmd.Method) || string.IsNullOrWhiteSpace(cmd.Path))
    {
        return Results.Json(new { error = "method e path obrigatorios" }, statusCode: StatusCodes.Status400BadRequest);
    }
    if (!cmd.Path.StartsWith('/'))
    {
        return Results.Json(new { error = "path deve comecar com /" }, statusCode: StatusCodes.Status400BadRequest);
    }

    byte[] body;
    try
    {
        body = DecodeBody(cmd);
    }
    catch (FormatException)
    {
        return Results.Json(new { error = "bodyBase64 invalido" }, statusCode: StatusCodes.Status400BadRequest);
    }

    var result = cms.PassThrough(ehomeId, cmd.Method, cmd.Path, body);
    if (result.Offline)
    {
        return Results.Json(new { error = "leitor offline" }, statusCode: StatusCodes.Status404NotFound);
    }

    var payload = EncodeResult(result.Status, result.Body);
    return Results.Json(payload);
});

app.MapPost("/media", async (HttpRequest request) =>
{
    MediaUpload? upload;
    try
    {
        upload = await request.ReadFromJsonAsync<MediaUpload>();
    }
    catch (JsonException)
    {
        return Results.Json(new { error = "json invalido" }, statusCode: StatusCodes.Status400BadRequest);
    }
    if (upload == null || string.IsNullOrEmpty(upload.BodyBase64))
    {
        return Results.Json(new { error = "bodyBase64 obrigatorio" }, statusCode: StatusCodes.Status400BadRequest);
    }
    byte[] bytes;
    try
    {
        bytes = Convert.FromBase64String(upload.BodyBase64);
    }
    catch (FormatException)
    {
        return Results.Json(new { error = "bodyBase64 invalido" }, statusCode: StatusCodes.Status400BadRequest);
    }
    if (bytes.Length < 3 || bytes[0] != 0xFF || bytes[1] != 0xD8 || bytes.Length > MediaStore.MaxBytes)
    {
        return Results.Json(new { error = "jpeg invalido ou maior que 512 KB" }, statusCode: StatusCodes.Status400BadRequest);
    }
    var mediaToken = media.Put(bytes);
    Console.WriteLine($"[isup] media put {mediaToken[..6]} len={bytes.Length}");
    return Results.Json(new { url = $"{mediaPublicBase}/f/{mediaToken}.jpg", expiresInSec = 120 });
});

app.MapGet("/f/{file}", (string file, HttpContext ctx) =>
{
    if (ctx.Connection.LocalPort != mediaPort || !file.EndsWith(".jpg", StringComparison.Ordinal))
    {
        return Results.NotFound();
    }
    var mediaToken = file[..^4];
    var bytes = media.Get(mediaToken);
    Console.WriteLine($"[isup] media get {(mediaToken.Length >= 6 ? mediaToken[..6] : mediaToken)} from={ctx.Connection.RemoteIpAddress} hit={bytes != null}");
    return bytes == null ? Results.NotFound() : Results.Bytes(bytes, "image/jpeg");
});

Console.WriteLine($"[isup] CMS 0.0.0.0:{listenPort} controle https 0.0.0.0:{controlPort} media http 0.0.0.0:{mediaPort}");
app.Run();

static void LinkNativeAliases(string dir)
{
    foreach (var name in new[] { "HCISUPCMS.so", "HCISUPStream.so", "HCISUPAlarm.so", "HCISUPSS.so" })
    {
        var src = Path.Combine(dir, "lib" + name);
        var dst = Path.Combine(dir, name);
        if (File.Exists(src) && !File.Exists(dst))
        {
            File.Copy(src, dst);
        }
    }
    foreach (var (from, to) in new[] { ("libcrypto.so", "libcrypto.so.1.1"), ("libssl.so", "libssl.so.1.1") })
    {
        var src = Path.Combine(dir, from);
        var dst = Path.Combine(dir, to);
        if (File.Exists(src) && !File.Exists(dst))
        {
            File.Copy(src, dst);
        }
    }
}

const int RtldNow = 2;
const int RtldGlobal = 0x100;

[DllImport("libdl.so.2", EntryPoint = "dlopen")]
static extern IntPtr Dlopen(string file, int flags);

[DllImport("libdl.so.2", EntryPoint = "dlerror")]
static extern IntPtr Dlerror();

static void PreloadNative(string dir)
{
    string[] libs =
    [
        "libz.so",
        "libcrypto.so.1.1",
        "libssl.so.1.1",
        "libhpr.so",
        "libHCNetUtils.so",
        "HCAapSDKCom/libiconv2.so",
        "HCAapSDKCom/libSystemTransform.so",
    ];
    foreach (var rel in libs)
    {
        var path = Path.Combine(dir, rel);
        if (!File.Exists(path))
        {
            Console.Error.WriteLine($"[isup] biblioteca ausente {rel}");
            continue;
        }
        _ = Dlerror();
        var handle = Dlopen(path, RtldNow | RtldGlobal);
        if (handle == IntPtr.Zero)
        {
            var err = Marshal.PtrToStringAnsi(Dlerror()) ?? "dlopen";
            throw new InvalidOperationException($"dlopen {rel}: {err}");
        }
    }
}

static bool BearerOk(string header, string expected)
{
    const string prefix = "Bearer ";
    if (!header.StartsWith(prefix, StringComparison.Ordinal)) return false;
    var got = Encoding.UTF8.GetBytes(header[prefix.Length..]);
    var want = Encoding.UTF8.GetBytes(expected);
    if (got.Length != want.Length) return false;
    return CryptographicOperations.FixedTimeEquals(got, want);
}

static byte[] DecodeBody(IsapiCommand cmd)
{
    if (!string.IsNullOrEmpty(cmd.BodyBase64))
    {
        return Convert.FromBase64String(cmd.BodyBase64);
    }
    if (cmd.Body == null) return Array.Empty<byte>();
    if (cmd.Body.Value.ValueKind == JsonValueKind.String)
    {
        return Encoding.UTF8.GetBytes(cmd.Body.Value.GetString() ?? "");
    }
    return Encoding.UTF8.GetBytes(cmd.Body.Value.GetRawText());
}

static object EncodeResult(int status, byte[] body)
{
    if (body.Length == 0)
    {
        return new { status, headers = new Dictionary<string, string>(), body = "" };
    }
    if (TrySplitHttp(body, out var httpStatus, out var headers, out var payload))
    {
        return EncodeBytes(httpStatus, headers, payload);
    }
    var guessed = new Dictionary<string, string>
    {
        ["Content-Type"] = LooksLikeText(body) ? "application/json" : "application/octet-stream",
    };
    return EncodeBytes(status, guessed, body);
}

static object EncodeBytes(int status, Dictionary<string, string> headers, byte[] payload)
{
    if (!LooksLikeText(payload))
    {
        return new
        {
            status,
            headers,
            body = "",
            bodyBase64 = Convert.ToBase64String(payload),
        };
    }
    return new
    {
        status,
        headers,
        body = Encoding.UTF8.GetString(payload),
    };
}

static bool LooksLikeText(byte[] payload)
{
    if (payload.Length >= 2 && payload[0] == 0xFF && payload[1] == 0xD8) return false;
    try
    {
        var utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);
        var text = utf8.GetString(payload);
        return !text.Contains('\0');
    }
    catch (DecoderFallbackException)
    {
        return false;
    }
}

static bool TrySplitHttp(byte[] body, out int status, out Dictionary<string, string> headers, out byte[] payload)
{
    status = 200;
    headers = new Dictionary<string, string>();
    payload = body;
    if (body.Length < 12) return false;
    if (body[0] != (byte)'H' || body[1] != (byte)'T' || body[2] != (byte)'T' || body[3] != (byte)'P')
    {
        return false;
    }
    var sep = IndexOf(body, Encoding.ASCII.GetBytes("\r\n\r\n"));
    if (sep < 0) return false;
    var head = Encoding.ASCII.GetString(body, 0, sep);
    var lines = head.Split("\r\n");
    var parts = lines[0].Split(' ');
    if (parts.Length >= 2 && int.TryParse(parts[1], out var code)) status = code;
    foreach (var line in lines.Skip(1))
    {
        var colon = line.IndexOf(':');
        if (colon <= 0) continue;
        headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
    }
    payload = body[(sep + 4)..];
    return true;
}

static int IndexOf(byte[] haystack, byte[] needle)
{
    for (var i = 0; i <= haystack.Length - needle.Length; i++)
    {
        var ok = true;
        for (var j = 0; j < needle.Length; j++)
        {
            if (haystack[i + j] != needle[j])
            {
                ok = false;
                break;
            }
        }
        if (ok) return i;
    }
    return -1;
}

sealed record IsapiCommand(
    string? Method,
    string? Path,
    Dictionary<string, string>? Headers,
    JsonElement? Body,
    string? BodyBase64,
    JsonElement? Credentials);

sealed record MediaUpload(string? BodyBase64);

/// <summary>JPEG em memória para o leitor baixar via faceURL (o passthrough ISUP não leva multipart binário).</summary>
sealed class MediaStore
{
    public const int MaxBytes = 512 * 1024;
    private const int MaxEntries = 200;
    private readonly TimeSpan ttl;
    private readonly object gate = new();
    private readonly Dictionary<string, (byte[] Bytes, DateTimeOffset ExpiresAt)> items = new(StringComparer.Ordinal);

    public MediaStore(TimeSpan ttl)
    {
        this.ttl = ttl;
    }

    public string Put(byte[] bytes)
    {
        var id = RandomNumberGenerator.GetHexString(32, lowercase: true);
        var now = DateTimeOffset.UtcNow;
        lock (gate)
        {
            foreach (var key in items.Where(pair => pair.Value.ExpiresAt <= now).Select(pair => pair.Key).ToList())
            {
                items.Remove(key);
            }
            if (items.Count >= MaxEntries)
            {
                items.Remove(items.MinBy(pair => pair.Value.ExpiresAt).Key);
            }
            items[id] = (bytes, now + ttl);
        }
        return id;
    }

    public byte[]? Get(string id)
    {
        lock (gate)
        {
            if (!items.TryGetValue(id, out var item)) return null;
            if (item.ExpiresAt > DateTimeOffset.UtcNow) return item.Bytes;
            items.Remove(id);
            return null;
        }
    }
}

sealed class CmsListener
{
    private readonly string isupKey;
    private readonly string publicHost;
    private readonly int listenPort;
    private readonly DEVICE_REGISTER_CB callback;
    private readonly object gate = new();
    private readonly Dictionary<string, Session> sessions = new(StringComparer.Ordinal);
    private int listenHandle = -1;

    public CmsListener(string isupKey, string publicHost, int listenPort)
    {
        this.isupKey = isupKey;
        this.publicHost = publicHost;
        this.listenPort = listenPort;
        callback = OnRegister;
    }

    public void Start()
    {
        if (!NET_ECMS_Init())
        {
            throw new InvalidOperationException($"NET_ECMS_Init falhou ({NET_ECMS_GetLastError()})");
        }

        var secure = new NET_EHOME_LOCAL_ACCESS_SECURITY
        {
            dwSize = Marshal.SizeOf<NET_EHOME_LOCAL_ACCESS_SECURITY>(),
            byAccessSecurity = (byte)CmsAccessSecurityMode.SecurityMode,
            byRes = new byte[127],
        };
        var securePtr = Marshal.AllocHGlobal(secure.dwSize);
        try
        {
            Marshal.StructureToPtr(secure, securePtr, false);
            if (!NET_ECMS_SetSDKLocalCfg(NET_EHOME_LOCAL_CFG_TYPE.ACTIVE_ACCESS_SECURITY, securePtr))
            {
                throw new InvalidOperationException($"SetSDKLocalCfg falhou ({NET_ECMS_GetLastError()})");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(securePtr);
        }

        var listen = new NET_EHOME_CMS_LISTEN_PARAM();
        listen.struAddress.Init();
        var ip = Encoding.ASCII.GetBytes(IPAddress.Any.ToString());
        var ipDest = listen.struAddress.szIP ?? throw new InvalidOperationException("szIP");
        Array.Copy(ip, ipDest, Math.Min(ip.Length, ipDest.Length));
        listen.struAddress.wPort = (ushort)listenPort;
        listen.fnCB = callback;
        listen.byRes = new byte[32];
        listenHandle = NET_ECMS_StartListen(ref listen);
        if (listenHandle < 0)
        {
            throw new InvalidOperationException($"StartListen falhou ({NET_ECMS_GetLastError()})");
        }
    }

    public object List()
    {
        lock (gate)
        {
            return sessions.Select(pair => new
            {
                ehomeId = pair.Key,
                online = pair.Value.Online,
                lastSeenAt = pair.Value.LastSeen.UtcDateTime.ToString("o"),
            }).ToArray();
        }
    }

    public PassResult PassThrough(string ehomeId, string method, string path, byte[] body)
    {
        int loginId;
        lock (gate)
        {
            if (!sessions.TryGetValue(ehomeId, out var session) || !session.Online)
            {
                return PassResult.NotOnline();
            }
            loginId = session.LoginId;
        }

        var url = Encoding.ASCII.GetBytes($"{method.ToUpperInvariant()} {path}");
        var outSize = Math.Clamp(Math.Max(body.Length, 256 * 1024) + 64 * 1024, 64 * 1024, 8 * 1024 * 1024);
        var urlPtr = Marshal.AllocHGlobal(url.Length + 1);
        var inPtr = body.Length > 0 ? Marshal.AllocHGlobal(body.Length) : IntPtr.Zero;
        var outPtr = Marshal.AllocHGlobal(outSize);
        var paramPtr = Marshal.AllocHGlobal(Marshal.SizeOf<NET_EHOME_PTXML_PARAM>());
        try
        {
            Marshal.Copy(url, 0, urlPtr, url.Length);
            Marshal.WriteByte(urlPtr, url.Length, 0);
            if (body.Length > 0) Marshal.Copy(body, 0, inPtr, body.Length);
            Marshal.Copy(new byte[outSize], 0, outPtr, outSize);
            var param = new NET_EHOME_PTXML_PARAM
            {
                pRequestUrl = urlPtr,
                dwRequestUrlLen = url.Length,
                pCondBuffer = IntPtr.Zero,
                dwCondSize = 0,
                pInBuffer = inPtr,
                dwInSize = body.Length,
                pOutBuffer = outPtr,
                dwOutSize = outSize,
                dwReturnedXMLLen = 0,
                byRes = new byte[32],
            };
            Marshal.StructureToPtr(param, paramPtr, false);
            bool ok;
            lock (gate)
            {
                ok = NET_ECMS_ISAPIPassThrough(loginId, paramPtr);
                if (sessions.TryGetValue(ehomeId, out var current) && current.LoginId == loginId)
                {
                    sessions[ehomeId] = current with { LastSeen = DateTimeOffset.UtcNow };
                }
            }
            param = Marshal.PtrToStructure<NET_EHOME_PTXML_PARAM>(paramPtr);
            var returned = param.dwReturnedXMLLen;
            if (returned < 0 || returned > outSize) returned = 0;
            var bytes = new byte[returned];
            if (returned > 0)
            {
                Marshal.Copy(outPtr, bytes, 0, returned);
            }
            else if (ok)
            {
                var raw = new byte[Math.Min(outSize, 256 * 1024)];
                Marshal.Copy(outPtr, raw, 0, raw.Length);
                var end = Array.IndexOf(raw, (byte)0);
                if (end < 0) end = Array.FindLastIndex(raw, b => b != 0) + 1;
                if (end > 0) bytes = raw[..end];
            }
            if (!ok && bytes.Length == 0)
            {
                var err = NET_ECMS_GetLastError();
                var message = Encoding.UTF8.GetBytes($"{{\"error\":\"isapi {err}\"}}");
                return new PassResult(false, 502, message);
            }
            var preview = Encoding.ASCII.GetString(bytes, 0, Math.Min(bytes.Length, 80)).Replace("\r", " ").Replace("\n", " ");
            Console.WriteLine($"[isup] passthrough ok={ok} len={bytes.Length} err={NET_ECMS_GetLastError()} head={preview}");
            return new PassResult(false, 200, bytes);
        }
        finally
        {
            Marshal.FreeHGlobal(urlPtr);
            if (inPtr != IntPtr.Zero) Marshal.FreeHGlobal(inPtr);
            Marshal.FreeHGlobal(outPtr);
            Marshal.FreeHGlobal(paramPtr);
        }
    }

    private bool OnRegister(
        int iUserID,
        int dwDataType,
        IntPtr pOutBuffer,
        int dwOutLen,
        IntPtr pInBuffer,
        int dwInLen,
        IntPtr pUser)
    {
        NET_EHOME_DEV_REG_INFO_V12 info = new();
        info.Init();
        if (pOutBuffer != IntPtr.Zero &&
            (dwDataType == ENUM_DEV_ON || dwDataType == ENUM_DEV_AUTH ||
             dwDataType == ENUM_DEV_SESSIONKEY || dwDataType == ENUM_DEV_ADDRESS_CHANGED))
        {
            info = Marshal.PtrToStructure<NET_EHOME_DEV_REG_INFO_V12>(pOutBuffer);
        }

        if (dwDataType == ENUM_DEV_ON)
        {
            var id = CString(info.struRegInfo.byDeviceID);
            if (id.Length > 0)
            {
                lock (gate)
                {
                    sessions[id] = new Session(iUserID, DateTimeOffset.UtcNow, true);
                }
                Console.WriteLine($"[isup] online {id}");
            }
            WriteServerInfo(pInBuffer);
        }
        else if (dwDataType == ENUM_DEV_OFF)
        {
            lock (gate)
            {
                var match = sessions.FirstOrDefault(pair => pair.Value.LoginId == iUserID && pair.Value.Online);
                if (!string.IsNullOrEmpty(match.Key))
                {
                    sessions[match.Key] = match.Value with { Online = false, LastSeen = DateTimeOffset.UtcNow };
                    Console.WriteLine($"[isup] offline {match.Key}");
                }
            }
        }
        else if (dwDataType == ENUM_DEV_AUTH && pInBuffer != IntPtr.Zero)
        {
            var padded = isupKey.PadRight(32, '\0');
            if (padded.Length > 32) padded = padded[..32];
            var buffer = Encoding.ASCII.GetBytes(padded);
            Marshal.Copy(buffer, 0, pInBuffer, buffer.Length);
        }
        else if (dwDataType == ENUM_DEV_SESSIONKEY)
        {
            var key = new NET_EHOME_DEV_SESSIONKEY();
            key.Init();
            CopyBytes(info.struRegInfo.byDeviceID, key.sDeviceID);
            CopyBytes(info.struRegInfo.bySessionKey, key.sSessionKey);
            NET_ECMS_SetDeviceSessionKey(ref key);
        }
        else if (dwDataType == ENUM_DEV_DAS_REQ && pInBuffer != IntPtr.Zero)
        {
            var json = JsonSerializer.Serialize(new
            {
                Type = "DAS",
                DasInfo = new
                {
                    Address = publicHost,
                    Domain = "test.ys7.com",
                    ServerID = $"das_{publicHost}_{listenPort}",
                    Port = listenPort,
                    UdpPort = listenPort,
                },
            });
            var buffer = Encoding.ASCII.GetBytes(json);
            Marshal.Copy(buffer, 0, pInBuffer, Math.Min(buffer.Length, dwInLen > 0 ? dwInLen : buffer.Length));
        }

        return true;
    }

    private static void WriteServerInfo(IntPtr pInBuffer)
    {
        if (pInBuffer == IntPtr.Zero) return;
        var serv = Marshal.PtrToStructure<NET_EHOME_SERVER_INFO_V50>(pInBuffer);
        serv.dwKeepAliveSec = 15;
        serv.dwTimeOutCount = 6;
        serv.dwNTPInterval = 3600;
        Marshal.StructureToPtr(serv, pInBuffer, false);
    }

    private static void CopyBytes(byte[]? source, byte[]? destination)
    {
        if (source == null || destination == null) return;
        Array.Copy(source, destination, Math.Min(source.Length, destination.Length));
    }

    private static string CString(byte[]? bytes)
    {
        if (bytes == null || bytes.Length == 0) return "";
        var end = Array.IndexOf(bytes, (byte)0);
        if (end < 0) end = bytes.Length;
        return Encoding.ASCII.GetString(bytes, 0, end).Trim();
    }

    private sealed record Session(int LoginId, DateTimeOffset LastSeen, bool Online);

    public readonly record struct PassResult(bool Offline, int Status, byte[] Body)
    {
        public static PassResult NotOnline() => new(true, 404, Array.Empty<byte>());
    }

    private enum CmsAccessSecurityMode : byte
    {
        SecurityMode = 2,
    }
}
