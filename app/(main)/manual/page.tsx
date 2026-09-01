function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-bold text-gray-900 mb-2 pb-1 border-b border-gray-200">{title}</h2>
      <div className="text-sm text-gray-700 space-y-2">{children}</div>
    </section>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <h3 className="text-sm font-semibold text-gray-800 mb-1">{title}</h3>
      <div className="text-sm text-gray-600 space-y-1.5">{children}</div>
    </div>
  )
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap ${className}`}>{children}</span>
}

export default function ManualPage() {
  return (
    <div className="p-6 overflow-y-auto flex-1 max-w-3xl">
      <h1 className="text-xl font-bold mb-1">操作マニュアル</h1>
      <p className="text-xs text-gray-400 mb-6">出面・石綿記録システムの使い方と、CBO連携についてのご案内です。</p>

      <Section title="このアプリについて">
        <p>
          三浦興業の出面（作業日報）・石綿作業従事者作業記録を管理するアプリです。CBO（CraftBank Office）と連携し、
          現場・作業者の情報や出面の記録をCBOと相互にやり取りします。
        </p>
      </Section>

      <Section title="CBOとの連携について（取込・反映）">
        <p>データのやり取りには「取込」と「反映」の2方向があります。</p>
        <SubSection title="取込（CBO → アプリ）">
          <p>「CBOから取込」ボタンを押すと、CBO側に登録されている現場・作業者・出面の情報をこのアプリに反映します。</p>
        </SubSection>
        <SubSection title="反映（アプリ → CBO）">
          <p>出面一覧・出面表の「CBOへ反映」ボタンを押すと、アプリ側で入力・編集した出面をCBOへ送信します。</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>ボタンを押すとすぐに「反映を開始しました」という表示が出ますが、これは受付完了の合図です。実際の送信はその後もバックグラウンドで続くため、<strong>画面を移動したり閉じたりしても処理は止まりません</strong>。</li>
            <li>件数が多い場合は自動的に分割して送信されるため、一度に大量の出面を反映しても失敗しにくくなっています。</li>
            <li>反映が正常に終わったかどうかは、後述の「同期・ログ」ページでいつでも確認できます。</li>
          </ul>
        </SubSection>
        <SubSection title="毎日の自動反映">
          <p>
            上記の手動操作に加えて、<strong>毎日20時以降に自動で</strong>直近7日分の未反映の出面がCBOへ反映されます。
            日々の入力を忘れずに反映したい場合でも、手動でボタンを押し忘れた分は自動実行でカバーされます。
          </p>
        </SubSection>
        <SubSection title="同期ステータスの見方（出面一覧）">
          <p>出面一覧の「同期」列には、各行のCBOとの連携状況がバッジで表示されます。</p>
          <ul className="space-y-1">
            <li><Badge className="bg-blue-100 text-blue-700">取込未済</Badge> まだCBOへ反映されていない、新規入力の出面です。</li>
            <li><Badge className="bg-gray-100 text-gray-600">取込済み</Badge> CBOへの反映が完了している出面です。</li>
            <li><Badge className="bg-orange-100 text-orange-700">取込後変更あり</Badge> 一度反映した後にアプリ側で内容を編集した出面です。再度「CBOへ反映」が必要です。</li>
          </ul>
        </SubSection>
      </Section>

      <Section title="現場一覧の使い方">
        <p>トップ画面（現場一覧）では、現場名・管轄・現場責任者・石綿の有無・工事ステータスで絞り込みができます。</p>
        <p>「CBOから取込（マスタ）」ボタンで、CBOに登録された最新の現場・作業者情報を取り込めます。現場・作業者の新規登録や情報修正はCBO側で行ってください（このアプリからは編集できません）。</p>
      </Section>

      <Section title="出面表の入力・編集">
        <p>現場を選択すると、その現場の月次の出面表が表示されます。</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>セルをクリックすると、その日・その作業者の出面を入力・編集できます。</li>
          <li>セルを範囲選択して「コピー」→ 別の範囲を選択して「貼り付け」（PCでは Ctrl+V も可）で、同じ内容を複数のセルにまとめて入力できます。</li>
          <li>「一括編集」から、複数の作業者・日付に対してまとめて内容を設定できます。</li>
          <li>「作業者を追加」で、その現場に出面を入力する作業者を追加できます。</li>
          <li>「Excel出力」で、表示中の月の出面表をExcelファイルとしてダウンロードできます。</li>
        </ul>
      </Section>

      <Section title="石綿作業従事者作業記録">
        <p>石綿ありの現場では、出面表の上部にあるタブから「石綿記録」に切り替えて、石綿作業従事者作業記録の入力・確認ができます。入力方法は出面表と同様です。Excel出力にも対応しています。</p>
      </Section>

      <Section title="同期・ログページ">
        <p>メニューの「同期・ログ」から、CBOとのやり取りの履歴や、対応が必要な項目を確認できます。</p>
        <SubSection title="競合レコード">
          <p>
            CBO側とアプリ側の両方で同じ出面が編集された場合、内容が競合として一覧に表示されます。
            「CBO版を採用」でCBO側の内容を優先するか、「再push」でアプリ側の内容を優先してCBOへ反映するかを選べます。
          </p>
        </SubSection>
        <SubSection title="同期ログ">
          <p>
            いつ・誰が（または自動実行が）・何を・どちらの方向に同期したか、成功/エラーの結果とともに確認できます。
            「詳細」からCBOへ送信・受信した内容も確認できるため、反映がうまくいかない場合はまずこちらをご確認ください。
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><Badge className="bg-indigo-100 text-indigo-700">🤖 自動</Badge> 毎日20時の自動反映など、システムが自動実行したものです。</li>
            <li><Badge className="bg-gray-100 text-gray-600">👤 手動</Badge> 画面のボタン操作によるものです。</li>
          </ul>
        </SubSection>
      </Section>

      <Section title="よくあるエラーと対処">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>「現場のCBO連携情報（cbo_order_id）が未設定です」</strong>：現場がCBO側と正しく紐付いていません。現場一覧で「CBOから取込（マスタ）」を実行し直してください。
          </li>
          <li>
            <strong>「reporter_cbo_user_id 未設定」</strong>：協力会社の作業者は本人がCBOに自己申告できないため、報告者の設定が必要です。管理者にご確認ください。
          </li>
          <li>
            反映件数が多いときに時間がかかる：CBO側の仕様で1件あたり間隔を空けて送信しているため、件数が多いほど時間がかかります。画面を離れても処理は継続されるので、しばらく待ってから「同期・ログ」で結果をご確認ください。
          </li>
        </ul>
      </Section>
    </div>
  )
}
