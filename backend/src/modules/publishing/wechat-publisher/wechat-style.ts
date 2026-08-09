export const WECHAT_DEFAULT_CSS = `
  section {
    font-size: 15px;
    line-height: 1.75;
    color: #333333;
    letter-spacing: 1px;
    margin-bottom: 1em;
  }
  
  h2 {
    font-size: 18px;
    color: #4CAF50; /* 自定义二级标题颜色 */
    border-left: 4px solid #4CAF50;
    padding-left: 10px;
    margin-top: 1.5em;
    margin-bottom: 1em;
    font-weight: bold;
  }
  
  h3 {
    font-size: 16px;
    color: #555555;
    margin-top: 1.2em;
    margin-bottom: 0.8em;
    font-weight: bold;
  }
  
  p {
    margin: 0 0 1em 0;
  }
  
  img {
    max-width: 100%;
    vertical-align: middle;
    border-radius: 4px;
    margin: 10px 0;
  }

  /* 顶部引导关注样式 */
  .wechat-header {
    text-align: center;
    color: #888888;
    font-size: 13px;
    margin-bottom: 2em;
    border-bottom: 1px dashed #dddddd;
    padding-bottom: 10px;
  }

  /* 底部作者名片样式 */
  .wechat-footer {
    margin-top: 3em;
    padding: 20px;
    background-color: #f9f9f9;
    border-radius: 8px;
    text-align: center;
    font-size: 14px;
    color: #666666;
  }
`;

export const WECHAT_HEADER_HTML = `
  <section class="wechat-header">
    <p>💡 欢迎关注我们的公众号，获取最新 AI 前沿资讯！</p>
  </section>
`;

export const WECHAT_FOOTER_HTML = `
  <section class="wechat-footer">
    <p>感谢阅读！如果喜欢这篇文章，请点赞和分享。</p>
  </section>
`;
