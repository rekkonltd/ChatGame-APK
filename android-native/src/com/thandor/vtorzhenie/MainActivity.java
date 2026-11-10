package com.thandor.vtorzhenie;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * THAN-DOR — оболочка для прототипа.
 *
 * Игра — это HTML5 Canvas, поэтому нативная часть минимальна:
 * полноэкранный WebView, портретная ориентация, ассеты отдаются из assets/.
 *
 * Ассеты перехватываются через shouldInterceptRequest, а не загружаются как
 * file:///android_asset/... — так страница живёт с обычным http-origin,
 * и fetch() для озвучки работает без CORS-ограничений.
 */
public class MainActivity extends Activity {

    private WebView web;

    private static final Map<String, String> MIME = new HashMap<String, String>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("png", "image/png");
        MIME.put("svg", "image/svg+xml");
        MIME.put("json", "application/json");
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(0xFF10130F);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setTextZoom(100);

        // без скролла и подсветки — это игра, а не документ
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return serveAsset(url);
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // никаких внешних переходов
                return !url.startsWith("http://thandor.local");
            }
        });

        web.loadUrl("http://thandor.local/index.html");
        setContentView(web);
        hideSystemBars();
    }

    /** Отдаёт файл из assets/ по URL http://thandor.local/<путь>. */
    private WebResourceResponse serveAsset(String url) {
        String prefix = "http://thandor.local/";
        if (url == null || !url.startsWith(prefix)) {
            return null; // пусть WebView обработает сам (например, about:blank)
        }
        String path = url.substring(prefix.length());
        int q = path.indexOf('?');
        if (q >= 0) path = path.substring(0, q);
        int h = path.indexOf('#');
        if (h >= 0) path = path.substring(0, h);
        if (path.length() == 0) path = "index.html";

        String ext = path.contains(".") ? path.substring(path.lastIndexOf('.') + 1) : "";
        String mime = MIME.get(ext);
        if (mime == null) mime = "application/octet-stream";

        try {
            InputStream in = getAssets().open("www/" + path);
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Cache-Control", "no-store");
            WebResourceResponse r = new WebResourceResponse(mime, "utf-8", in);
            if (Build.VERSION.SDK_INT >= 21) {
                r.setStatusCodeAndReasonPhrase(200, "OK");
                r.setResponseHeaders(headers);
            }
            return r;
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8",
                    new ByteArrayInputStream("Not found".getBytes()));
        }
    }

    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().getInsetsController().hide(
                    android.view.WindowInsets.Type.statusBars()
                            | android.view.WindowInsets.Type.navigationBars());
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    public void onBackPressed() {
        // системная «назад» из игры ничего не ломает, а выйти можно дважды
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }
}
