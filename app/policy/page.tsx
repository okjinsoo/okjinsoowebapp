import React from "react";

export default function PolicyPage() {
    return (
        <main className="min-h-screen bg-gray-50 flex justify-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 sm:p-12 mb-12">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">옥진수학 온라인 과외 서비스 이용약관</h1>
                <p className="text-sm text-gray-500 mb-8 pb-8 border-b border-gray-100">
                    시행일자: 2026년 3월 8일
                </p>

                <article className="prose prose-sm sm:prose-base prose-gray max-w-none">
                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제1조 (목적)</h2>
                    <p className="text-gray-700 leading-relaxed mb-6">
                        본 약관은 옥진수학(이하 “회사”라 한다)이 제공하는 온라인 과외 서비스(이하 “서비스”라 한다)의 이용조건 및 절차, 회사와 이용자(학부모 및 학생) 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.
                    </p>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제2조 (정의)</h2>
                    <ol className="list-decimal pl-5 space-y-2 text-gray-700 mb-6 marker:text-gray-400">
                        <li>“이용자”란 회사와 서비스 이용 계약을 체결하고 서비스를 이용하는 학부모를 의미합니다.</li>
                        <li>“수강생”이란 실제로 수업을 제공받는 학생을 의미하며, 미성년자인 경우 법정대리인(학부모)이 계약 당사자가 됩니다.</li>
                        <li>“이용기간”이란 결제일로부터 28일간을 의미합니다.</li>
                    </ol>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제3조 (약관의 효력 및 변경)</h2>
                    <ol className="list-decimal pl-5 space-y-2 text-gray-700 mb-6 marker:text-gray-400">
                        <li>본 약관은 서비스 신청 시 이용자가 동의함으로써 효력이 발생합니다.</li>
                        <li>회사는 관련 법령을 위반하지 않는 범위에서 약관을 개정할 수 있으며, 변경된 약관은 홈페이지 또는 안내문을 통해 공지 후 효력이 발생합니다.</li>
                    </ol>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제4조 (서비스의 제공)</h2>
                    <ol className="list-decimal pl-5 space-y-2 text-gray-700 mb-6 marker:text-gray-400">
                        <li>회사는 온라인 화상 수업(Discord 등)을 통해 수학 과외 서비스를 제공합니다.</li>
                        <li>
                            서비스의 1회 수업 단위는 회사가 정한 시작 시간 중 하나에서 개시되며, 90분으로 진행됩니다.
                            <ul className="list-disc pl-5 mt-1 text-gray-600">
                                <li>현재 시작 시간 기준 : 16시, 17시 30분, 19시, 20시 30분 (2025. 08. 30.)</li>
                            </ul>
                        </li>
                        <li>수업은 사전에 협의한 특정 요일·시간에 진행됩니다.</li>
                        <li>회사는 불가피한 사유로 서비스의 전부 또는 일부를 변경하거나 종료할 수 있으며, 이 경우 최소 7일 전에 이용자에게 고지합니다.</li>
                    </ol>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제5조 (계약의 성립 및 결제)</h2>
                    <ol className="list-decimal pl-5 space-y-2 text-gray-700 mb-6 marker:text-gray-400">
                        <li>이용자는 회사가 정한 절차에 따라 신청서를 작성하고, 서비스 요금을 결제함으로써 계약이 성립합니다.</li>
                        <li>결제 방식은 신용카드, 계좌이체, 간편결제(PG사 연동) 등을 통해 이루어지며, 현금 결제 시 현금영수증 발급을 원칙으로 합니다.</li>
                    </ol>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제6조 (출결 및 결석 규정)</h2>
                    <ol className="list-decimal pl-5 space-y-2 text-gray-700 mb-6 marker:text-gray-400">
                        <li>수업은 정해진 요일·시간에 진행되며, 이용자의 사정으로 불참 시 해당 회차는 자동 차감됩니다.</li>
                        <li>사전 고지 없이 수업 시작 시간으로부터 15분 이상 지체할 경우 무단 결석으로 간주하며, 해당 회차는 차감됩니다.</li>
                        <li>무단 결석이 3회 이상 누적될 경우 회사는 서비스 제공을 중단할 수 있습니다.</li>
                    </ol>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제7조 (보강 및 취소)</h2>
                    <ol className="list-decimal pl-5 space-y-2 text-gray-700 mb-6 marker:text-gray-400">
                        <li>수업 연기(보강 요청)는 최소 12시간 전까지 사전 통보해야 하며, 월 1회에 한해 인정됩니다.</li>
                        <li>당일 취소 또는 12시간 이내의 수업 연기(보강 요청) 또는 수업 취소 요청은 무단 결석으로 간주하여 해당 회차가 차감됩니다.</li>
                        <li>
                            수강생에게 무단 결석 경력이 있는 경우, 회사는 이를 누적 관리합니다. 또한, 새로운 이용기간 중 무단 결석이 전혀 발생하지 않은 경우, 누적 관리된 무단 결석 횟수에서 1회를 추가 차감합니다.
                            <ul className="list-disc pl-5 mt-1 text-gray-600">
                                <li>예: 이전 이용기간 중 무단 결석 2회 → 새로운 이용기간 중 무단 결석이 없을 경우, 1회 차감되어 최종 무단 결석 1회만 반영</li>
                            </ul>
                        </li>
                        <li>
                            다음 각 호에 해당하는 경우는 무단 결석으로 보지 않으며, 증빙 자료 제출 시 보강 또는 이용기간 연장을 통해 보충할 수 있습니다. 단, 해당 사유로 인한 결석은 <strong>2회 결석당 1회 보강</strong>을 원칙으로 합니다.
                            <ul className="list-disc pl-5 mt-1 space-y-1 text-gray-600">
                                <li>경조사(결혼, 장례 등)</li>
                                <li>가족 휴가, 가정 체험학습(사전 고지된 경우)</li>
                                <li>학교 주관 행사(수학여행, 수련회, 모의고사 등)</li>
                                <li>질병 등 건강상의 사유(의사 소견서 또는 진료 확인서 제출 시)</li>
                                <li>기타 회사가 합리적으로 인정하는 사유</li>
                            </ul>
                        </li>
                        <li>회사 귀책(강사 불참, 시스템 장애 등)으로 수업이 진행되지 못할 경우, 동일 회차 보강을 이용기간 내 제공하거나 환불합니다.</li>
                        <li>보강 수업은 원칙적으로 해당 이용기간 내에 이루어져야 하며, 이후 이용기간에 대한 보강은 회사와 이용자 간 합의가 있는 경우에만 가능합니다.</li>
                    </ol>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제8조 (서비스 휴무 기간의 처리)</h2>
                    <ol className="list-decimal pl-5 space-y-2 text-gray-700 mb-6 marker:text-gray-400">
                        <li>회사가 지정한 휴무나 연휴 기간으로 수업이 진행되지 못하는 경우, 해당 회차는 차감되지 않습니다.</li>
                        <li>
                            이용기간(28일)은 해당 휴무·연휴 기간만큼 자동 연장됩니다.
                            <ul className="list-disc pl-5 mt-1 text-gray-600">
                                <li>예: 회사 지정 연휴 7일 발생 시 총 이용기간은 35일로 연장됨.</li>
                            </ul>
                        </li>
                    </ol>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제9조 (환불 규정)</h2>
                    <ol className="list-decimal pl-5 space-y-2 text-gray-700 mb-6 marker:text-gray-400">
                        <li>서비스 개시 전(첫 수업 이전)에는 전액 환불 가능합니다.</li>
                        <li>
                            서비스 개시 후에는 이미 제공된 수업 회차를 제외한 금액만 환불 가능합니다.
                            <ul className="list-disc pl-5 mt-1 text-gray-600">
                                <li>예: 총 4회 결제 후 1회 이용 시, 3회분에 해당하는 금액 환불</li>
                            </ul>
                        </li>
                        <li>단, 전자상거래법 제17조 제2항 제5호에 따라, “이용자가 수업을 1회라도 수강한 경우”에는 해당 회차는 환불이 제한됩니다.</li>
                        <li>환불은 「소비자분쟁해결기준(교육·문화 분야)」에 따릅니다.</li>
                        <li>무단 결석은 환불 정산 시 보강 대상에 포함되지 않으며, 이미 차감된 회차는 환불에서 제외됩니다.</li>
                    </ol>

                    <div className="p-5 mt-10 bg-blue-50 border border-blue-100 rounded-xl">
                        <h2 className="text-xl font-bold text-blue-900 mb-4 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-blue-600">
                                <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
                            </svg>
                            제10조 (개인정보보호 및 Google 사용자 데이터 관리 방침)
                        </h2>
                        <ol className="list-decimal pl-5 space-y-3 text-blue-900 mb-2 marker:text-blue-500">
                            <li>회사는 수집된 개인정보를 수업 운영 및 고객 관리 목적 외에는 사용하지 않으며, 제3자에게 절대 제공, 양도, 판매하지 않습니다. 다만, 부득이하게 외부 업체에 위탁하는 경우 사전에 이용자에게 고지하고 동의를 받습니다.</li>
                            <li>회사는 관련 법령에 따라 서비스 종료 후 1년간 개인정보를 보관한 뒤 지체 없이 안전하게 파기합니다.</li>
                            <li><strong>Google 캘린더 연동 및 데이터 사용 목적</strong>: 본 서비스(`okjinsoomath`)는 원활한 화상 수업 일정 관리 및 Google Meet 링크 자동 생성을 위해, 제한된 권한이 부여된 이용자(원장, 강사 등 관리자)에 한하여 Google 캘린더 연동(OAuth)을 제공합니다.</li>
                            <li>
                                <strong>수집 권한 및 활용 범위</strong>: 회사는 Google 캘린더 연동을 통해 수집된 권한(`.../auth/calendar`, `.../auth/calendar.events`)을 오직 <strong>&apos;옥진수학 학원 내부 스케줄 동기화 및 수업 일정 생성/수정&apos; 목적으로만 사용</strong>합니다. 이용자의 개인 캘린더 일정을 무단으로 열람하거나, 시스템과 무관한 일정을 삭제 또는 타 마케팅 목적으로 활용하지 않습니다.
                            </li>
                            <li><strong>제한적 사용 요건(Limited Use) 준수</strong>: 본 서비스가 Google API로부터 수신한 정보의 사용 및 다른 앱으로의 전송은 <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="underline font-semibold hover:text-blue-700">Google API 서비스 사용자 데이터 정책(Google API Services User Data Policy)</a>의 제한적 사용 방침(Limited Use requirements)을 엄격히 준수합니다.</li>
                            <li>해당 연동 권한은 로그인한 사용자가 언제든지 Google 계정의 보안 설정(내 계정 접속 허용된 타사 앱) 메뉴에서 클릭 한 번으로 철회할 수 있습니다.</li>
                        </ol>
                    </div>

                    <h2 className="text-xl font-bold text-gray-900 mt-10 mb-4">제11조 (서비스 제공 불가 및 면책)</h2>
                    <ol className="list-decimal pl-5 space-y-2 text-gray-700 mb-6 marker:text-gray-400">
                        <li>회사는 천재지변, 대규모 정전, 정부 지침, 감염병 확산, 외부 화상 플랫폼(Discord 등) 장애와 같이 회사가 통제할 수 없는 사유로 서비스 제공이 불가능하거나 지연되는 경우 책임을 지지 않습니다.</li>
                        <li>회사 귀책(강사 불참, 내부 운영상의 문제 등)으로 서비스 제공이 이루어지지 못한 경우, 회사는 해당 수업을 보강하거나 비용을 환불할 의무를 집니다.</li>
                        <li>이용자의 기기 결함, 인터넷 불안정 등 수강생 측 사유로 서비스 이용이 불가능한 경우 회사는 책임을 지지 않으며, 해당 회차는 차감됩니다.</li>
                    </ol>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제12조 (분쟁 해결 및 관할 법원)</h2>
                    <ol className="list-decimal pl-5 space-y-2 text-gray-700 mb-6 marker:text-gray-400">
                        <li>이용자는 서비스 이용계약을 해지할 수 있으며, 이 경우 환불 규정(제9조)을 따릅니다.</li>
                        <li>회사는 무단 결석이 3회 이상 누적되거나, 이용자가 본 약관을 중대하게 위반한 경우 계약을 해지할 수 있습니다.</li>
                        <li>회사와 이용자 간 분쟁은 상호 합의를 통해 우선 해결하며, 합의가 어려운 경우 「소비자분쟁해결기준」을 따릅니다.</li>
                        <li>그럼에도 불구하고 분쟁이 해결되지 않는 경우, 최종 관할 법원은 서울중앙지방법원으로 합니다.</li>
                    </ol>

                    <div className="p-5 mt-10 bg-gray-50 border border-gray-200 rounded-xl">
                        <h3 className="font-bold text-gray-900 mb-2">고지 사항</h3>
                        <p className="text-gray-600 text-sm leading-relaxed">
                            본 약관에서 정하지 않은 사항 또는 해석에 이견이 있는 경우에는 「전자상거래 등에서의 소비자보호에 관한 법률」 제13조 및 제17조와 공정거래위원회 고시 「소비자분쟁해결기준(교육·문화 분야)」을 따릅니다.
                        </p>
                    </div>
                </article>
            </div>
        </main>
    );
}
